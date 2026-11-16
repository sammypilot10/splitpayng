import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, prisma, resetDb, resetMocks, createUser, createHostWithPool, signCookie, createDueRecurringMembership } from './helpers/index.js';
import { processRecurringBilling } from '../src/job/escrowExpiry.js';

describe('Money Math & Pricing', () => {
  beforeEach(async () => {
    await resetDb();
    resetMocks();
  });

  it('G1: for prices 100, 999, 1500, 2500, 7499, 12345: platformFee = floor(20%), hostPayout = amount - fee, and fee + hostPayout === amount on JOIN and RECURRING transactions', async () => {
    const prices = [100, 999, 1500, 2500, 7499, 12345];

    for (const price of prices) {
      // 1. JOIN transaction test
      const host = await createUser({ role: 'HOST', emailVerified: true });
      const { pool } = await createHostWithPool({ host, pool: { pricePerSeat: price } });
      const member = await createUser({ role: 'MEMBER', emailVerified: true });

      const initRes = await request(app)
        .post('/api/payments/initialize')
        .set('Cookie', signCookie(member))
        .send({ poolId: pool.id });

      expect(initRes.status).toBe(200);
      const reference = initRes.body.data.reference;

      // Simulate webhook charge.success to process JOIN transaction
      const webhookPayload = {
        event: 'charge.success',
        data: {
          reference,
          status: 'success',
          amount: price * 100,
          customer: { email: member.email },
          authorization: {
            authorization_code: 'AUTH_mock_' + reference,
            card_type: 'visa',
            last4: '4081',
            exp_month: '12',
            exp_year: '2030',
            bank: 'TEST BANK',
            reusable: true,
          },
        },
      };

      const sig = (await import('./helpers/index.js')).signWebhook(webhookPayload);
      const webhookRes = await request(app)
        .post('/api/payments/webhook')
        .set('x-paystack-signature', sig)
        .send(webhookPayload);

      expect(webhookRes.status).toBe(200);

      const tx = await prisma.transaction.findUnique({ where: { reference } });
      expect(tx).not.toBeNull();
      const expectedFee = Math.floor(price * 0.20);
      const expectedPayout = price - expectedFee;

      expect(tx!.platformFee).toBe(expectedFee);
      expect(tx!.hostPayout).toBe(expectedPayout);
      expect(tx!.platformFee + tx!.hostPayout).toBe(price);
      expect(tx!.amount).toBe(price);

      // 2. RECURRING transaction test
      await resetDb();
      resetMocks();

      const recurringSetup = await createDueRecurringMembership({ pricePerSeat: price });
      // Run recurring billing processor
      await processRecurringBilling();

      const recurringTx = await prisma.transaction.findFirst({
        where: {
          membershipId: recurringSetup.membership.id,
          type: 'RECURRING',
        },
      });

      expect(recurringTx).not.toBeNull();
      expect(recurringTx!.platformFee).toBe(expectedFee);
      expect(recurringTx!.hostPayout).toBe(expectedPayout);
      expect(recurringTx!.platformFee + recurringTx!.hostPayout).toBe(price);
      expect(recurringTx!.amount).toBe(price);

      await resetDb();
      resetMocks();
    }
  });

  it('G2: pool price is validated server-side (cannot be 0 or negative) on POST /api/pools', async () => {
    const host = await createUser({ role: 'HOST', emailVerified: true });
    const cookie = signCookie(host);

    // Try pricePerSeat: 0
    const resZero = await request(app)
      .post('/api/pools')
      .set('Cookie', cookie)
      .send({
        name: 'Test Pool Zero',
        category: 'Entertainment',
        pricePerSeat: 0,
        totalSeats: 4,
        encryptedCredentials: 'encrypted-credentials-blob',
      });

    expect(resZero.status).toBe(400);
    expect(resZero.body.errors?.body?.some((e: string) => e.includes('pricePerSeat')) || resZero.body.message === 'Validation failed').toBe(true);

    // Try pricePerSeat: -500
    const resNegative = await request(app)
      .post('/api/pools')
      .set('Cookie', cookie)
      .send({
        name: 'Test Pool Negative',
        category: 'Entertainment',
        pricePerSeat: -500,
        totalSeats: 4,
        encryptedCredentials: 'encrypted-credentials-blob',
      });

    expect(resNegative.status).toBe(400);

    // Verify no Pool rows were created
    const poolsCount = await prisma.pool.count();
    expect(poolsCount).toBe(0);
  });
});
