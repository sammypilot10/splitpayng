/**
 * Group D — escrow expiry (src/job/escrowExpiry.ts → processExpiredEscrows).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma, resetDb, resetMocks, createUser, createHostWithPool } from './helpers/index.js';
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

    // Count payout transitions that actually happened.
    const [updateManySpy, origUpdateMany] = spyOnPrisma(prisma.payout, 'updateMany');
    const transitions: number[] = [];
    updateManySpy.mockImplementation((async (args: any) => {
      const r = await origUpdateMany.call(prisma.payout, args);
      transitions.push(r.count);
      return r;
    }) as any);

    await Promise.all([
      processExpiredEscrows().finally(barrier.releaseAll),
      processExpiredEscrows().finally(barrier.releaseAll),
    ]);
    expect(barrier.arrived).toBe(2);

    expect(transitions.filter((c) => c === 1)).toHaveLength(1);
    const m = await prisma.membership.findUnique({ where: { id: membership.id } });
    expect(m!.status).toBe('ACTIVE');
    const p = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(p!.status).toBe('SCHEDULED');
    expect(await prisma.payout.count()).toBe(1);
    expect(await prisma.notification.count()).toBe(0);
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
