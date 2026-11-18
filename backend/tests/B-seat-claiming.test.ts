/**
 * Group B — concurrent seat claiming (src/routes/payments.ts → processPayment).
 * Real Postgres, real parallelism (Promise.all over HTTP), mocked Paystack + email.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
  app,
  prisma,
  paystackMocks,
  resetDb,
  resetMocks,
  createUser,
  createHostWithPool,
  createMembership,
  createPendingJoinTransaction,
} from './helpers/index.js';
import { chargeSuccessPayload, postWebhook, restorePrismaSpies } from './helpers/concurrency.js';

const SEAT_STATUSES = ['ACTIVE', 'IN_ESCROW', 'DISPUTED'] as const;

async function seedJoiners(poolId: string, n: number) {
  const txns = [];
  for (let i = 0; i < n; i++) {
    const user = await createUser();
    txns.push(await createPendingJoinTransaction({ userId: user.id, poolId }));
  }
  return txns;
}

describe('Group B: concurrent seat claiming', () => {
  beforeEach(async () => {
    await resetDb();
    resetMocks();
  });

  afterEach(() => {
    restorePrismaSpies();
  });

  it('B1: 1 seat, 5 concurrent charge.success webhooks -> 1 IN_ESCROW membership, pool FULL, 1 payout, 4 refunds, 4 REFUNDED txns', async () => {
    const { pool } = await createHostWithPool({ totalSeats: 1, pricePerSeat: 2500 });
    const txns = await seedJoiners(pool.id, 5);

    const responses = await Promise.all(txns.map((t) => postWebhook(chargeSuccessPayload(t.reference))));
    responses.forEach((r) => expect(r.status).toBe(200));

    const memberships = await prisma.membership.findMany({ where: { poolId: pool.id } });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].status).toBe('IN_ESCROW');

    const poolAfter = await prisma.pool.findUnique({ where: { id: pool.id } });
    expect(poolAfter!.status).toBe('FULL');

    expect(await prisma.payout.count()).toBe(1);

    const after = await prisma.transaction.findMany({ where: { reference: { in: txns.map((t) => t.reference) } } });
    const winners = after.filter((t) => t.status === 'SUCCESS');
    const refunded = after.filter((t) => t.status === 'REFUNDED');
    expect(winners).toHaveLength(1);
    expect(winners[0].membershipId).toBe(memberships[0].id);
    expect(refunded).toHaveLength(4);

    const refundMock = vi.mocked(paystackMocks.refundTransaction);
    expect(refundMock).toHaveBeenCalledTimes(4);
    expect(refundMock.mock.calls.map((c) => c[0]).sort()).toEqual(refunded.map((t) => t.reference).sort());
  });

  it('B2: 3 seats, 10 concurrent joins -> 3 memberships, 7 refunds', async () => {
    const { pool } = await createHostWithPool({ totalSeats: 3, pricePerSeat: 2500 });
    const txns = await seedJoiners(pool.id, 10);

    const responses = await Promise.all(txns.map((t) => postWebhook(chargeSuccessPayload(t.reference))));
    responses.forEach((r) => expect(r.status).toBe(200));

    const memberships = await prisma.membership.findMany({ where: { poolId: pool.id } });
    expect(memberships).toHaveLength(3);
    memberships.forEach((m) => expect(m.status).toBe('IN_ESCROW'));

    const after = await prisma.transaction.findMany({ where: { reference: { in: txns.map((t) => t.reference) } } });
    expect(after.filter((t) => t.status === 'SUCCESS')).toHaveLength(3);
    expect(after.filter((t) => t.status === 'REFUNDED')).toHaveLength(7);
    expect(vi.mocked(paystackMocks.refundTransaction)).toHaveBeenCalledTimes(7);
    expect(await prisma.payout.count()).toBe(3);
    expect((await prisma.pool.findUnique({ where: { id: pool.id } }))!.status).toBe('FULL');
  });

  it.each(['ACTIVE', 'IN_ESCROW'] as const)(
    'B3: user with existing %s membership pays again -> no second seat consumed',
    async (status) => {
      const { pool } = await createHostWithPool({ totalSeats: 2, pricePerSeat: 2500 });
      const member = await createUser();
      const existing = await createMembership({ userId: member.id, poolId: pool.id, status });
      const seatsBefore = await prisma.membership.count({ where: { poolId: pool.id, status: { in: [...SEAT_STATUSES] } } });

      const txn = await createPendingJoinTransaction({ userId: member.id, poolId: pool.id });
      const res = await postWebhook(chargeSuccessPayload(txn.reference));
      expect(res.status).toBe(200);

      const memberships = await prisma.membership.findMany({ where: { poolId: pool.id } });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].id).toBe(existing.id);
      expect(memberships[0].status).toBe(status);

      const seatsAfter = await prisma.membership.count({ where: { poolId: pool.id, status: { in: [...SEAT_STATUSES] } } });
      expect(seatsAfter).toBe(seatsBefore);
      expect((await prisma.pool.findUnique({ where: { id: pool.id } }))!.status).toBe('ACTIVE');

      // Documented in plan: the duplicate payment is recorded against the existing
      // membership and NOT auto-refunded (no seat consumed, no payout created).
      const txnAfter = await prisma.transaction.findUnique({ where: { reference: txn.reference } });
      expect(txnAfter!.status).toBe('SUCCESS');
      expect(txnAfter!.membershipId).toBe(existing.id);
      expect(await prisma.payout.count({ where: { transactionId: txn.id } })).toBe(0);
    }
  );

  it.each(['CANCELLED', 'FAILED'] as const)(
    'B4: %s member re-joins -> reuses existing membership row, no unique-constraint 500',
    async (status) => {
      const { pool } = await createHostWithPool({ totalSeats: 2, pricePerSeat: 2500 });
      const member = await createUser();
      const old = await createMembership({ userId: member.id, poolId: pool.id, status });

      const txn = await createPendingJoinTransaction({ userId: member.id, poolId: pool.id });
      const res = await request(app).get('/api/payments/verify').query({ reference: txn.reference });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const memberships = await prisma.membership.findMany({ where: { userId: member.id, poolId: pool.id } });
      expect(memberships).toHaveLength(1);
      expect(memberships[0].id).toBe(old.id);
      expect(memberships[0].status).toBe('IN_ESCROW');

      const txnAfter = await prisma.transaction.findUnique({ where: { reference: txn.reference } });
      expect(txnAfter!.status).toBe('SUCCESS');
      expect(txnAfter!.membershipId).toBe(old.id);
      expect(await prisma.payout.count({ where: { transactionId: txn.id } })).toBe(1);
    }
  );
});
