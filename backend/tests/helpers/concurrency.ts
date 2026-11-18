/**
 * Test-only helpers for deterministic concurrency / crash-window tests (groups B–F).
 *
 * Design rules:
 *  - No sleeps / timers. Every interleaving is forced with event-based gates.
 *  - Every gate has an event-based release fallback (e.g. "release when any
 *    participant finishes") so a future, fixed implementation that no longer
 *    hits the instrumented call can never deadlock the test.
 *  - Instrumentation wraps the ORIGINAL prisma method (captured before spying),
 *    so the real query still runs against real Postgres.
 */
import request from 'supertest';
import { vi } from 'vitest';
import { app, prisma, signWebhook } from './index.js';

// ─── Prisma-safe spies ────────────────────────────────────────────────────
//
// Prisma 5 model delegates / the client are composite Proxies. Vitest's
// `mockRestore()` restores by *deleting* the own property, which the Prisma
// proxy records as a permanent deletion — the method then becomes `undefined`
// for the rest of the file (observed: "prisma.membership.findUnique is not a
// function"). `vi.restoreAllMocks()` re-runs that deletion for every spy ever
// created. Therefore:
//   - create spies with `spyOnPrisma` (still `vi.spyOn` under the hood),
//   - restore them in `afterEach` with `restorePrismaSpies()`, which calls
//     `mockRestore()` and then re-assigns the captured original,
//   - NEVER call `vi.restoreAllMocks()` in these test files.

const originals = new WeakMap<object, Map<string, any>>();
const activeSpies: Array<{ obj: any; key: string; spy: any }> = [];

function originalOf(obj: any, key: string) {
  let m = originals.get(obj);
  if (!m) {
    m = new Map();
    originals.set(obj, m);
  }
  if (!m.has(key)) m.set(key, obj[key]);
  return m.get(key);
}

/** `vi.spyOn` that can be safely restored on Prisma proxies. Returns [spy, original]. */
export function spyOnPrisma<T = any>(obj: any, key: string): [any, T] {
  const original = originalOf(obj, key);
  const spy = vi.spyOn(obj, key as any);
  activeSpies.push({ obj, key, spy });
  return [spy, original];
}

/** Restore every spy created with `spyOnPrisma`. Call in `afterEach`. */
export function restorePrismaSpies() {
  for (const { obj, key, spy } of activeSpies.splice(0).reverse()) {
    spy.mockRestore();
    obj[key] = originalOf(obj, key);
  }
}

// ─── Gates ────────────────────────────────────────────────────────────────

/** All `n` participants must arrive before any of them continues. */
export function createBarrier(n: number) {
  let arrived = 0;
  let released = false;
  const waiters: Array<() => void> = [];
  const releaseAll = () => {
    released = true;
    waiters.splice(0).forEach((r) => r());
  };
  return {
    async arrive() {
      arrived++;
      if (released) return;
      if (arrived >= n) {
        releaseAll();
        return;
      }
      await new Promise<void>((r) => waiters.push(r));
    },
    releaseAll,
    get arrived() {
      return arrived;
    },
  };
}

/**
 * The first caller passes straight through; every later caller is held until
 * `open()` is called (typically when the first caller's DB transaction commits).
 */
export function createFirstThroughGate() {
  let passed = false;
  let isOpen = false;
  const waiters: Array<() => void> = [];
  return {
    async enter() {
      if (!passed) {
        passed = true;
        return;
      }
      if (isOpen) return;
      await new Promise<void>((r) => waiters.push(r));
    },
    open() {
      isOpen = true;
      waiters.splice(0).forEach((r) => r());
    },
    get held() {
      return waiters.length;
    },
  };
}

/**
 * Spy on `delegate[method]`: run the real query, then wait at the barrier before
 * returning the result. Forces N concurrent callers to all have read the same
 * snapshot before any of them writes.
 */
export function holdAfterRead(delegate: any, method: string, barrier: { arrive(): Promise<void> }) {
  const [spy, original] = spyOnPrisma(delegate, method);
  return spy.mockImplementation(async (...args: any[]) => {
    const result = await original.apply(delegate, args);
    await barrier.arrive();
    return result;
  });
}

// ─── Webhooks ─────────────────────────────────────────────────────────────

export function chargeSuccessPayload(reference: string, extra: Record<string, any> = {}) {
  return {
    event: 'charge.success',
    data: {
      reference,
      status: 'success',
      amount: 250000,
      gateway_response: 'Successful',
      customer: { email: 'payer@example.com' },
      authorization: {
        authorization_code: 'AUTH_mock_' + reference,
        card_type: 'visa',
        last4: '4081',
        exp_month: '12',
        exp_year: '2030',
        bank: 'TEST BANK',
        brand: 'visa',
        reusable: true,
      },
      ...extra,
    },
  };
}

export function transferPayload(event: 'transfer.success' | 'transfer.failed' | 'transfer.reversed', reference: string, extra: Record<string, any> = {}) {
  return {
    event,
    data: { reference, transfer_code: 'TRF_paystack_' + reference, ...extra },
  };
}

export function postWebhook(payload: unknown) {
  const body = JSON.stringify(payload);
  return request(app)
    .post('/api/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', signWebhook(body))
    .send(body);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

/**
 * Builds host (+ optional bank account) → pool → member → membership →
 * JOIN transaction (SUCCESS) → payout. Returns every row.
 */
export async function createMembershipWithPayout(opts: {
  host: any;
  pool: any;
  member: any;
  membershipStatus?: any;
  escrowEndsAt?: Date | null;
  payoutStatus?: any;
  payoutDueAt?: Date | null;
  transferCode?: string | null;
  transactionStatus?: any;
}) {
  const { host, pool, member } = opts;
  const membership = await prisma.membership.create({
    data: {
      userId: member.id,
      poolId: pool.id,
      status: opts.membershipStatus || 'ACTIVE',
      escrowEndsAt: opts.escrowEndsAt ?? null,
      nextBillingDate: new Date(Date.now() + 30 * 86400_000),
    },
  });
  const amount = pool.pricePerSeat;
  const platformFee = Math.floor(amount * 0.2);
  const transaction = await prisma.transaction.create({
    data: {
      userId: member.id,
      membershipId: membership.id,
      reference: `ref_fixture_${membership.id}`,
      amount,
      platformFee,
      hostPayout: amount - platformFee,
      status: opts.transactionStatus || 'SUCCESS',
      type: 'JOIN',
      paystackData: { poolId: pool.id, userId: member.id },
    },
  });
  const payout = await prisma.payout.create({
    data: {
      transactionId: transaction.id,
      hostId: host.id,
      amount: transaction.hostPayout,
      status: opts.payoutStatus || 'PENDING',
      payoutDueAt: opts.payoutDueAt ?? null,
      transferCode: opts.transferCode ?? null,
    },
  });
  return { membership, transaction, payout };
}