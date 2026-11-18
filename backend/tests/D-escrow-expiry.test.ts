/**
 * Group D — escrow expiry (src/job/escrowExpiry.ts → processExpiredEscrows).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma, emailMocks, resetDb, resetMocks, createUser, createHostWithPool } from './helpers/index.js';
import { createBarrier, createMembershipWithPayout, holdAfterRead, restorePrismaSpies, spyOnPrisma } from './helpers/concurrency.js';
import { processExpiredEscrows } from '../src/job/escrowExpiry.js';

const HOUR = 3600_000;

async function expiredEscrowFixture() {
  const { host, pool } = await createHostWithPool({ totalSeats: 4, pricePerSeat: 2500 });
  const member = await createUser();
  const rows = await createMembershipWithPayout({
    host,
    pool,
    member,
    membershipStatus: 'IN_ESCROW',
    escrowEndsAt: new Date(Date.now() - HOUR),
    payoutStatus: 'PENDING',
  });
  return { host, pool, member, ...rows };
}

describe('Group D: escrow expiry', () => {
  beforeEach(async () => {
    await resetDb();
    resetMocks();
  });

  afterEach(() => {
    restorePrismaSpies();
  });

  it('D1: expired IN_ESCROW membership -> ACTIVE and payout SCHEDULED with payoutDueAt <= now', async () => {
    const { membership, payout } = await expiredEscrowFixture();

    await processExpiredEscrows();
    const now = Date.now();

    const m = await prisma.membership.findUnique({ where: { id: membership.id } });
    expect(m!.status).toBe('ACTIVE');
    const p = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(p!.status).toBe('SCHEDULED');
    expect(p!.payoutDueAt).not.toBeNull();
    expect(p!.payoutDueAt!.getTime()).toBeLessThanOrEqual(now);
  });

  // EXPECTED-FAIL: unconditional membership.update without status guard.
  it('D2: RACE — membership becomes DISPUTED after findMany, before write -> stays DISPUTED, payout NOT scheduled', async () => {
    const { membership, payout } = await expiredEscrowFixture();

    // Inject the dispute at the exact window: after the job's findMany has
    // returned the IN_ESCROW snapshot, before its per-membership write.
    const [findManySpy, origFindMany] = spyOnPrisma(prisma.membership, 'findMany');
    let injected = false;
    findManySpy.mockImplementation((async (args: any) => {
      const result = await origFindMany.call(prisma.membership, args);
      if (!injected) {
        injected = true;
        // Concurrent "raise dispute" committed by another request (raw SQL so it
        // does not go through the instrumented delegate).
        await prisma.$executeRaw`UPDATE "Membership" SET status = 'DISPUTED' WHERE id = ${membership.id}`;
      }
      return result;
    }) as any);

    await processExpiredEscrows();
    expect(injected).toBe(true);

    const m = await prisma.membership.findUnique({ where: { id: membership.id } });
    expect(m!.status).toBe('DISPUTED');
    const p = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(p!.status).toBe('PENDING');
    expect(p!.payoutDueAt).toBeNull();
  });

  it('D3: run twice concurrently -> payout scheduled once, no duplicate side effects', async () => {
    const { membership, payout } = await expiredEscrowFixture();

    // Force both runs to read the same IN_ESCROW snapshot before either writes.
    const barrier = createBarrier(2);
    holdAfterRead(prisma.membership, 'findMany', barrier);

    // Observe tx.payout.updateMany counts through prisma.$transaction without mutating tx.
    const [txSpy, origTx] = spyOnPrisma(prisma, '$transaction');
    const payoutUpdateCounts: number[] = [];
    txSpy.mockImplementation(((fnOrOps: any, ...rest: any[]) => {
      if (typeof fnOrOps !== 'function') {
        return (origTx as any).call(prisma, fnOrOps, ...rest);
      }
      return (origTx as any).call(
        prisma,
        async (tx: any) => {
          const observedTx = new Proxy(tx, {
            get(target, prop, receiver) {
              if (prop === 'payout') {
                const payoutDelegate = Reflect.get(target, prop, receiver);
                return new Proxy(payoutDelegate, {
                  get(pTarget, pProp, pReceiver) {
                    const value = Reflect.get(pTarget, pProp, pReceiver);
                    if (pProp === 'updateMany' && typeof value === 'function') {
                      return async (...args: any[]) => {
                        const r = await value.apply(pTarget, args);
                        payoutUpdateCounts.push(r.count);
                        return r;
                      };
                    }
                    return typeof value === 'function' ? value.bind(pTarget) : value;
                  },
                });
              }
              const value = Reflect.get(target, prop, receiver);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          return fnOrOps(observedTx);
        },
        ...rest
      );
    }) as any);

    await Promise.all([
      processExpiredEscrows().finally(barrier.releaseAll),
      processExpiredEscrows().finally(barrier.releaseAll),
    ]);
    expect(barrier.arrived).toBe(2);

    expect(payoutUpdateCounts).toEqual([1]);
    const m = await prisma.membership.findUnique({ where: { id: membership.id } });
    expect(m!.status).toBe('ACTIVE');
    const p = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(p!.status).toBe('SCHEDULED');
    expect(p!.payoutDueAt).not.toBeNull();

    // Follow-up run must leave status and payoutDueAt untouched.
    await processExpiredEscrows();
    const pAfter = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(pAfter!.status).toBe('SCHEDULED');
    expect(pAfter!.payoutDueAt).toEqual(p!.payoutDueAt);
    expect(payoutUpdateCounts).toEqual([1]);

    expect(await prisma.payout.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(0);
    const totalEmailCalls = Object.values(emailMocks)
      .filter((fn) => vi.isMockFunction(fn))
      .reduce((sum, fn) => sum + (fn as any).mock.calls.length, 0);
    expect(totalEmailCalls).toBe(0);
  });

  it('D4: membership with no successful transaction does not crash the loop', async () => {
    const { host, pool } = await createHostWithPool({ totalSeats: 4, pricePerSeat: 2500 });

    // Orphan: expired IN_ESCROW membership with no SUCCESS JOIN transaction / payout.
    // Created first so it is (very likely) iterated before the healthy one; the
    // assertions hold regardless of order.
    const orphanUser = await createUser();
    const orphan = await prisma.membership.create({
      data: {
        userId: orphanUser.id,
        poolId: pool.id,
        status: 'IN_ESCROW',
        escrowEndsAt: new Date(Date.now() - 2 * HOUR),
      },
    });

    const member = await createUser();
    const healthy = await createMembershipWithPayout({
      host,
      pool,
      member,
      membershipStatus: 'IN_ESCROW',
      escrowEndsAt: new Date(Date.now() - HOUR),
      payoutStatus: 'PENDING',
    });

    await expect(processExpiredEscrows()).resolves.toBeUndefined();

    expect((await prisma.membership.findUnique({ where: { id: orphan.id } }))!.status).toBe('ACTIVE');
    expect((await prisma.membership.findUnique({ where: { id: healthy.membership.id } }))!.status).toBe('ACTIVE');
    expect((await prisma.payout.findUnique({ where: { id: healthy.payout.id } }))!.status).toBe('SCHEDULED');
    expect(await prisma.payout.count()).toBe(1);
  });
});
