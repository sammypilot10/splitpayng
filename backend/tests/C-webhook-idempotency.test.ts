/**
 * Group C — webhook replay & idempotency (src/routes/payments.ts → processPayment).
 *
 * C1/C2 race determinism:
 *   processPayment reads `webhookLog.processed`, `transaction.status` and the
 *   existing membership OUTSIDE the locked $transaction. To reproduce the race
 *   deterministically (no sleeps), we instrument `prisma.membership.findUnique`
 *   (the existing-membership read) with a "first-through" gate: the first caller
 *   proceeds; every later caller — which has already passed the
 *   processed/SUCCESS checks — is held until the first caller's seat-claim
 *   `prisma.$transaction` has settled. This is a real, reachable interleaving of
 *   concurrent HTTP requests; the gate only makes it repeatable. The gate also
 *   opens when any request finishes, so a fixed implementation can never deadlock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
  app,
  prisma,
  emailMocks,
  resetDb,
  resetMocks,
  createUser,
  createHostWithPool,
  createPendingJoinTransaction,
} from './helpers/index.js';
import {
  chargeSuccessPayload,
  createBarrier,
  createFirstThroughGate,
  postWebhook,
  restorePrismaSpies,
  spyOnPrisma,
} from './helpers/concurrency.js';

function installRaceSchedule(participants: number) {
  // Stage 1: every request must have read the transaction row (status PENDING)
  // before any of them continues — i.e. all have passed the non-atomic
  // `webhookLog.processed` / `transaction.status === 'SUCCESS'` checks.
  const readBarrier = createBarrier(participants);
  const [txnSpy, origTxnFindUnique] = spyOnPrisma(prisma.transaction, 'findUnique');
  txnSpy.mockImplementation((async (args: any) => {
    const result = await (origTxnFindUnique as any).call(prisma.transaction, args);
    if (args?.include?.user) await readBarrier.arrive();
    return result;
  }) as any);

  // Stage 2: first request reads the existing membership and claims the seat;
  // the others read the existing membership only after that claim committed.
  const gate = createFirstThroughGate();
  const [memSpy, origFindUnique] = spyOnPrisma(prisma.membership, 'findUnique');
  memSpy.mockImplementation((async (args: any) => {
    if (args?.where?.userId_poolId) await gate.enter();
    return (origFindUnique as any).call(prisma.membership, args);
  }) as any);
  const [txSpy, origTx] = spyOnPrisma(prisma, '$transaction');
  txSpy.mockImplementation((async (...args: any[]) => {
    try {
      return await (origTx as any).apply(prisma, args);
    } finally {
      gate.open();
    }
  }) as any);

  /** Any request completing releases every gate (deadlock guard for fixed code). */
  const track = <T>(p: PromiseLike<T>) =>
    Promise.resolve(p).finally(() => {
      readBarrier.releaseAll();
      gate.open();
    });
  return { track, readBarrier };
}

async function sideEffectCounts(userId: string, hostId: string) {
  return {
    paymentSuccessEmail: vi.mocked(emailMocks.sendPaymentSuccessEmail).mock.calls.length,
    newMemberEmail: vi.mocked(emailMocks.sendNewMemberEmail).mock.calls.length,
    paymentSuccessNotif: await prisma.notification.count({ where: { userId, type: 'PAYMENT_SUCCESS' } }),
    newMemberNotif: await prisma.notification.count({ where: { userId: hostId, type: 'NEW_MEMBER' } }),
  };
}

describe('Group C: webhook replay & idempotency', () => {
  beforeEach(async () => {
    await resetDb();
    resetMocks();
  });

  afterEach(() => {
    restorePrismaSpies();
  });

  // EXPECTED-FAIL: non-atomic check-then-act in processPayment.
  it('C1: same charge.success webhook delivered 10x concurrently -> 1 membership, 1 payout, each email/notification ONCE', async () => {
    const { host, pool } = await createHostWithPool({ totalSeats: 4, pricePerSeat: 2500 });
    const member = await createUser();
    const txn = await createPendingJoinTransaction({ userId: member.id, poolId: pool.id });
    const payload = chargeSuccessPayload(txn.reference);

    const { track } = installRaceSchedule(10);
    const responses = await Promise.all(Array.from({ length: 10 }, () => track(postWebhook(payload))));

    // Single outcome assertion: the race can surface as duplicate side effects
    // and/or as a P2002 500 from the non-atomic webhookLog.upsert; either way the
    // diff below shows exactly which invariant broke.
    expect({
      httpStatuses: responses.map((r) => r.status),
      memberships: await prisma.membership.count({ where: { userId: member.id, poolId: pool.id } }),
      payouts: await prisma.payout.count({ where: { transactionId: txn.id } }),
      txnStatus: (await prisma.transaction.findUnique({ where: { id: txn.id } }))!.status,
      ...(await sideEffectCounts(member.id, host.id)),
    }).toEqual({
      httpStatuses: Array(10).fill(200),
      memberships: 1,
      payouts: 1,
      txnStatus: 'SUCCESS',
      paymentSuccessEmail: 1,
      newMemberEmail: 1,
      paymentSuccessNotif: 1,
      newMemberNotif: 1,
    });
  });

  // EXPECTED-FAIL: same race reached via /verify + /webhook.
  it('C2: GET /verify and POST /webhook for the same reference concurrently -> 1 membership, emails once, neither errors', async () => {
    const { host, pool } = await createHostWithPool({ totalSeats: 4, pricePerSeat: 2500 });
    const member = await createUser();
    const txn = await createPendingJoinTransaction({ userId: member.id, poolId: pool.id });

    const { track } = installRaceSchedule(2);
    const [verifyRes, webhookRes] = await Promise.all([
      track(request(app).get('/api/payments/verify').query({ reference: txn.reference })),
      track(postWebhook(chargeSuccessPayload(txn.reference))),
    ]);

    // Order-independent outcome: which of the two requests loses a race is not
    // deterministic, so statuses are sorted and errors counted.
    const results = [verifyRes, webhookRes];
    expect({
      httpStatuses: results.map((r) => r.status).sort(),
      errorResponses: results.filter((r) => r.status !== 200 || r.body?.success === false).length,
      memberships: await prisma.membership.count({ where: { userId: member.id, poolId: pool.id } }),
      payouts: await prisma.payout.count({ where: { transactionId: txn.id } }),
      ...(await sideEffectCounts(member.id, host.id)),
    }).toEqual({
      httpStatuses: [200, 200],
      errorResponses: 0,
      memberships: 1,
      payouts: 1,
      paymentSuccessEmail: 1,
      newMemberEmail: 1,
      paymentSuccessNotif: 1,
      newMemberNotif: 1,
    });
  });

  it('C3: webhook replayed AFTER completion -> 200, no state change', async () => {
    const { host, pool } = await createHostWithPool({ totalSeats: 4, pricePerSeat: 2500 });
    const member = await createUser();
    const txn = await createPendingJoinTransaction({ userId: member.id, poolId: pool.id });
    const payload = chargeSuccessPayload(txn.reference);

    const first = await postWebhook(payload);
    expect(first.status).toBe(200);

    const snapshot = async () => ({
      memberships: await prisma.membership.findMany({ orderBy: { id: 'asc' } }),
      transactions: await prisma.transaction.findMany({ orderBy: { id: 'asc' } }),
      payouts: await prisma.payout.findMany({ orderBy: { id: 'asc' } }),
      pools: await prisma.pool.findMany({ orderBy: { id: 'asc' } }),
      notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
      webhookLogs: await prisma.webhookLog.findMany({ orderBy: { id: 'asc' } }),
      paymentMethods: await prisma.paymentMethod.findMany({ orderBy: { id: 'asc' } }),
    });
    const before = await snapshot();
    const effectsBefore = await sideEffectCounts(member.id, host.id);
    expect(effectsBefore.paymentSuccessEmail).toBe(1);

    const replay = await postWebhook(payload);
    expect(replay.status).toBe(200);

    expect(await snapshot()).toEqual(before);
    expect(await sideEffectCounts(member.id, host.id)).toEqual(effectsBefore);
  });
});
