import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import { chargeSuccessPayload, postWebhook } from './helpers/concurrency.js';

const MINUTE = 60_000;

describe('Webhook stale-claim recovery', () => {
  beforeEach(async () => {
    await resetDb();
    resetMocks();
  });

  it('reclaims a stale unprocessed webhookLog (>2 min old) once even under concurrent retries', async () => {
    const { host, pool } = await createHostWithPool({ totalSeats: 4, pricePerSeat: 2500 });
    const member = await createUser();
    const txn = await createPendingJoinTransaction({ userId: member.id, poolId: pool.id });

    await prisma.webhookLog.create({
      data: {
        reference: txn.reference,
        event: 'charge.success',
        processed: false,
        createdAt: new Date(Date.now() - 3 * MINUTE),
      },
    });

    const payload = chargeSuccessPayload(txn.reference);
    const responses = await Promise.all(Array.from({ length: 5 }, () => postWebhook(payload)));

    expect(responses.map((r) => r.status)).toEqual(Array(5).fill(200));
    expect(await prisma.membership.count({ where: { userId: member.id, poolId: pool.id } })).toBe(1);
    expect(await prisma.payout.count({ where: { transactionId: txn.id } })).toBe(1);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe('SUCCESS');
    expect((await prisma.webhookLog.findUniqueOrThrow({ where: { reference: txn.reference } })).processed).toBe(true);
    expect(vi.mocked(emailMocks.sendPaymentSuccessEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emailMocks.sendNewMemberEmail)).toHaveBeenCalledTimes(1);
    expect(await prisma.notification.count({ where: { userId: member.id, type: 'PAYMENT_SUCCESS' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: host.id, type: 'NEW_MEMBER' } })).toBe(1);
  });

  it('does not reclaim a fresh unprocessed webhookLog (<2 min old) and returns 200 Already processed', async () => {
    const { pool } = await createHostWithPool({ totalSeats: 4, pricePerSeat: 2500 });
    const member = await createUser();
    const txn = await createPendingJoinTransaction({ userId: member.id, poolId: pool.id });

    await prisma.webhookLog.create({
      data: {
        reference: txn.reference,
        event: 'charge.success',
        processed: false,
        createdAt: new Date(Date.now() - 30_000),
      },
    });

    const verifyRes = await request(app).get('/api/payments/verify').query({ reference: txn.reference });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toEqual({ success: true, message: 'Already processed' });

    const webhookRes = await postWebhook(chargeSuccessPayload(txn.reference));
    expect(webhookRes.status).toBe(200);

    expect(await prisma.membership.count({ where: { userId: member.id, poolId: pool.id } })).toBe(0);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe('PENDING');
    expect((await prisma.webhookLog.findUniqueOrThrow({ where: { reference: txn.reference } })).processed).toBe(false);
    expect(vi.mocked(emailMocks.sendPaymentSuccessEmail)).not.toHaveBeenCalled();
  });

  it('does not reclaim a completed webhookLog (processed=true) even if older than 2 min', async () => {
    const { pool } = await createHostWithPool({ totalSeats: 4, pricePerSeat: 2500 });
    const member = await createUser();
    const txn = await createPendingJoinTransaction({ userId: member.id, poolId: pool.id });

    await prisma.webhookLog.create({
      data: {
        reference: txn.reference,
        event: 'charge.success',
        processed: true,
        createdAt: new Date(Date.now() - 10 * MINUTE),
      },
    });

    const verifyRes = await request(app).get('/api/payments/verify').query({ reference: txn.reference });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toEqual({ success: true, message: 'Already processed' });

    const webhookRes = await postWebhook(chargeSuccessPayload(txn.reference));
    expect(webhookRes.status).toBe(200);

    expect(await prisma.membership.count({ where: { userId: member.id, poolId: pool.id } })).toBe(0);
    expect(vi.mocked(emailMocks.sendPaymentSuccessEmail)).not.toHaveBeenCalled();
  });
});
