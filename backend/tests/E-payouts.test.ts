/**
 * Group E — scheduled payouts & transfer webhooks
 * (src/job/escrowExpiry.ts → processScheduledPayouts, src/routes/payments.ts transfer.* webhooks,
 *  src/routes/bank.ts POST /setup).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import {
  app,
  prisma,
  paystackMocks,
  emailMocks,
  resetDb,
  resetMocks,
  createUser,
  createHostWithPool,
  signCookie,
} from './helpers/index.js';
import {
  createBarrier,
  createMembershipWithPayout,
  holdAfterRead,
  postWebhook,
  restorePrismaSpies,
  spyOnPrisma,
  transferPayload,
} from './helpers/concurrency.js';
import { processScheduledPayouts } from '../src/job/escrowExpiry.js';

const HOUR = 3600_000;

async function duePayoutFixture(opts: { withBankAccount?: boolean; membershipStatus?: any; payoutStatus?: any; transferCode?: string } = {}) {
  const { host, pool, bankAccount } = await createHostWithPool({
    totalSeats: 4,
    pricePerSeat: 2500,
    withBankAccount: opts.withBankAccount,
  });
  const member = await createUser();
  const rows = await createMembershipWithPayout({
    host,
    pool,
    member,
    membershipStatus: opts.membershipStatus || 'ACTIVE',
    payoutStatus: opts.payoutStatus || 'SCHEDULED',
    payoutDueAt: new Date(Date.now() - HOUR),
    transferCode: opts.transferCode ?? null,
  });
  return { host, pool, member, bankAccount, ...rows };
}

describe('Group E: scheduled payouts', () => {
  beforeEach(async () => {
    await resetDb();
    resetMocks();
  });

  afterEach(() => {
    restorePrismaSpies();
  });

  it('E1: due SCHEDULED payout with verified bank account -> initiateTransfer called once, payout PROCESSING', async () => {
    const { payout, bankAccount } = await duePayoutFixture();

    await processScheduledPayouts();

    const transfer = vi.mocked(paystackMocks.initiateTransfer);
    expect(transfer).toHaveBeenCalledTimes(1);
    const [amount, recipient, , reference] = transfer.mock.calls[0];
    expect(amount).toBe(payout.amount);
    expect(recipient).toBe(bankAccount!.recipientCode);

    const p = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(p!.status).toBe('PROCESSING');
    expect(p!.transferCode).toBe(reference);
  });

  it('E2: run twice concurrently -> initiateTransfer called EXACTLY once', async () => {
    const { payout } = await duePayoutFixture();

    // Force both runs to read the same SCHEDULED snapshot before either claims it.
    const barrier = createBarrier(2);
    holdAfterRead(prisma.payout, 'findMany', barrier);

    await Promise.all([
      processScheduledPayouts().finally(barrier.releaseAll),
      processScheduledPayouts().finally(barrier.releaseAll),
    ]);
    expect(barrier.arrived).toBe(2);

    expect(vi.mocked(paystackMocks.initiateTransfer)).toHaveBeenCalledTimes(1);
    const p = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(p!.status).toBe('PROCESSING');
  });

  it('E3: crash window — initiateTransfer succeeds then prisma.payout.update throws -> same transfer reference reused or no second transfer', async () => {
    const { payout } = await duePayoutFixture();
    const transfer = vi.mocked(paystackMocks.initiateTransfer);
    const defaultTransfer = transfer.getMockImplementation()!;

    // Mark the instant the Paystack mock has SUCCEEDED.
    let paystackSucceeded = false;
    transfer.mockImplementation(async (...args: any[]) => {
      const r = await (defaultTransfer as any)(...args);
      paystackSucceeded = true;
      return r;
    });

    // Inject the crash at the named point: any payout DB write after the
    // Paystack call succeeded throws (process "dies" before persisting).
    // `updateMany` is instrumented too because the working tree persists via
    // updateMany; on today's code no payout write happens after the transfer.
    const crash = new Error('SIMULATED CRASH: process died after Paystack transfer succeeded, before DB write');
    const postTransferWrites: string[] = [];
    for (const method of ['update', 'updateMany'] as const) {
      const [spy, original] = spyOnPrisma(prisma.payout, method);
      spy.mockImplementation((async (args: any) => {
        if (paystackSucceeded) {
          postTransferWrites.push(method);
          throw crash;
        }
        return (original as any).call(prisma.payout, args);
      }) as any);
    }

    // Run 1 — crashes (or completes) at the injection point.
    await processScheduledPayouts().catch(() => undefined);
    expect(paystackSucceeded).toBe(true);

    // "Restart": remove the fault, run the job again.
    restorePrismaSpies();
    transfer.mockImplementation(defaultTransfer as any);
    await processScheduledPayouts();

    const refs = transfer.mock.calls.map((c) => c[3]);
    expect(refs.length).toBeGreaterThanOrEqual(1);
    // Either no second transfer, or every transfer reused the same reference.
    expect(new Set(refs).size).toBe(1);

    const p = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(p!.transferCode).toBe(refs[0]);
    expect(['PROCESSING', 'COMPLETED']).toContain(p!.status);
  });

  it('E4: payout whose membership is DISPUTED is skipped', async () => {
    const { payout } = await duePayoutFixture({ membershipStatus: 'DISPUTED' });

    await processScheduledPayouts();

    expect(vi.mocked(paystackMocks.initiateTransfer)).not.toHaveBeenCalled();
    const p = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(p!.status).toBe('SCHEDULED');
    expect(p!.transferCode).toBeNull();
  });

  it('E5: host with no verified bank account -> payout FAILED with reason, host notified; adding verified bank reschedules payout', async () => {
    const { host, payout } = await duePayoutFixture({ withBankAccount: false });

    await processScheduledPayouts();

    expect(vi.mocked(paystackMocks.initiateTransfer)).not.toHaveBeenCalled();
    let p = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(p!.status).toBe('FAILED');
    expect(p!.failureReason).toBe('No verified bank account');
    expect(await prisma.notification.count({ where: { userId: host.id, type: 'BANK_ACCOUNT_REQUIRED' } })).toBe(1);

    const res = await request(app)
      .post('/api/banks/setup')
      .set('Cookie', signCookie(host))
      .send({ bankCode: '058', bankName: 'Guaranty Trust Bank', accountNumber: '0123456789', accountName: 'Host Account' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    p = await prisma.payout.findUnique({ where: { id: payout.id } });
    expect(p!.status).toBe('SCHEDULED');
    expect(p!.failureReason).toBeNull();
    expect(p!.payoutDueAt!.getTime()).toBeLessThanOrEqual(Date.now());

    // And the next job run actually pays it.
    await processScheduledPayouts();
    expect(vi.mocked(paystackMocks.initiateTransfer)).toHaveBeenCalledTimes(1);
    expect((await prisma.payout.findUnique({ where: { id: payout.id } }))!.status).toBe('PROCESSING');
  });

  describe('E6: transfer.* webhooks update payout and are idempotent', () => {
    it('transfer.success (delivered 3x concurrently, then replayed) -> COMPLETED, confirmation email + notification once', async () => {
      const ref = 'TRF-e6-success';
      const { host, payout } = await duePayoutFixture({ payoutStatus: 'PROCESSING', transferCode: ref });
      const payload = transferPayload('transfer.success', ref);

      const responses = await Promise.all([postWebhook(payload), postWebhook(payload), postWebhook(payload)]);
      responses.forEach((r) => expect(r.status).toBe(200));
      expect((await postWebhook(payload)).status).toBe(200);

      const p = await prisma.payout.findUnique({ where: { id: payout.id } });
      expect(p!.status).toBe('COMPLETED');
      expect(vi.mocked(emailMocks.sendPayoutConfirmedEmail)).toHaveBeenCalledTimes(1);
      expect(await prisma.notification.count({ where: { userId: host.id, type: 'PAYOUT_CONFIRMED' } })).toBe(1);
    });

    it.each(['transfer.failed', 'transfer.reversed'] as const)(
      '%s (delivered 3x concurrently, then replayed) -> FAILED with reason, transferCode cleared, host notified once',
      async (event) => {
        const ref = `TRF-e6-${event}`;
        const { host, payout } = await duePayoutFixture({ payoutStatus: 'PROCESSING', transferCode: ref });
        const payload = transferPayload(event, ref, { reason: 'Account closed' });

        const responses = await Promise.all([postWebhook(payload), postWebhook(payload), postWebhook(payload)]);
        responses.forEach((r) => expect(r.status).toBe(200));
        expect((await postWebhook(payload)).status).toBe(200);

        const p = await prisma.payout.findUnique({ where: { id: payout.id } });
        expect(p!.status).toBe('FAILED');
        expect(p!.failureReason).toBe('Account closed');
        expect(p!.transferCode).toBeNull();
        expect(await prisma.notification.count({ where: { userId: host.id, type: 'PAYOUT_FAILED' } })).toBe(1);
        expect(vi.mocked(emailMocks.sendPayoutConfirmedEmail)).not.toHaveBeenCalled();
      }
    );
  });
});

