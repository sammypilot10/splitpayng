/**
 * Group F — recurring billing (src/job/escrowExpiry.ts → processRecurringBilling,
 * src/utils/transactions.ts → completeRecurringCharge / failRecurringCharge).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  prisma,
  paystackMocks,
  emailMocks,
  resetDb,
  resetMocks,
  createDueRecurringMembership,
} from './helpers/index.js';
import {
  chargeSuccessPayload,
  createBarrier,
  holdAfterRead,
  postWebhook,
  restorePrismaSpies,
  spyOnPrisma,
} from './helpers/concurrency.js';
import { processRecurringBilling } from '../src/job/escrowExpiry.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Collect console.error output so we can assert "no unique-constraint error". */
function captureErrors() {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${(a as any).code ?? ''}` : String(a))).join(' '));
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe('Group F: recurring billing', () => {
  beforeEach(async () => {
    await resetDb();
    resetMocks();
  });

  afterEach(() => {
    restorePrismaSpies();
  });

  it('F1: due ACTIVE membership with saved card -> charged once, txn SUCCESS, nextBillingDate advanced, payout SCHEDULED +48h', async () => {
    const { membership, paymentMethod, pool, host } = await createDueRecurringMembership({ pricePerSeat: 2500 });

    const before = Date.now();
    await processRecurringBilling();
    const after = Date.now();

    const charge = vi.mocked(paystackMocks.chargeAuthorization);
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge.mock.calls[0][0]).toBe(paymentMethod!.authorizationCode);
    expect(charge.mock.calls[0][2]).toBe(pool.pricePerSeat);

    const txns = await prisma.transaction.findMany({ where: { membershipId: membership.id, type: 'RECURRING' } });
    expect(txns).toHaveLength(1);
    expect(txns[0].status).toBe('SUCCESS');

    const m = await prisma.membership.findUnique({ where: { id: membership.id } });
    expect(m!.status).toBe('ACTIVE');
    expect(m!.nextBillingDate!.getTime()).toBeGreaterThan(after);

    const payouts = await prisma.payout.findMany({ where: { transactionId: txns[0].id } });
    expect(payouts).toHaveLength(1);
    expect(payouts[0].status).toBe('SCHEDULED');
    expect(payouts[0].hostId).toBe(host.id);
    expect(payouts[0].amount).toBe(txns[0].hostPayout);
    expect(payouts[0].payoutDueAt!.getTime()).toBeGreaterThanOrEqual(before + 48 * HOUR);
    expect(payouts[0].payoutDueAt!.getTime()).toBeLessThanOrEqual(after + 48 * HOUR);
  });

  it('F2: run twice concurrently -> chargeAuthorization called EXACTLY once', async () => {
    const { membership } = await createDueRecurringMembership();

    // Force both runs to read the same "due" snapshot before either claims it.
    const barrier = createBarrier(2);
    holdAfterRead(prisma.membership, 'findMany', barrier);

    await Promise.all([
      processRecurringBilling().finally(barrier.releaseAll),
      processRecurringBilling().finally(barrier.releaseAll),
    ]);
    expect(barrier.arrived).toBe(2);

    expect(vi.mocked(paystackMocks.chargeAuthorization)).toHaveBeenCalledTimes(1);
    const txns = await prisma.transaction.findMany({ where: { membershipId: membership.id, type: 'RECURRING' } });
    expect(txns).toHaveLength(1);
    expect(await prisma.payout.count()).toBe(1);
  });

  it('F3: crash window after chargeAuthorization -> member NOT charged a second time on re-run', async () => {
    const { membership } = await createDueRecurringMembership();
    const charge = vi.mocked(paystackMocks.chargeAuthorization);
    const defaultCharge = charge.getMockImplementation()!;

    let paystackSucceeded = false;
    charge.mockImplementation(async (...args: any[]) => {
      const r = await (defaultCharge as any)(...args);
      paystackSucceeded = true;
      return r;
    });

    // The first DB write after a successful charge is completeRecurringCharge's
    // `prisma.$transaction(...)` (interactive-tx delegates `tx.*` cannot be
    // spied from outside, so the fault is injected on the $transaction call).
    const [txSpy, origTx] = spyOnPrisma(prisma, '$transaction');
    txSpy.mockImplementation((async (...args: any[]) => {
      if (paystackSucceeded) {
        throw new Error('SIMULATED CRASH: process died after chargeAuthorization succeeded, before DB write');
      }
      return (origTx as any).apply(prisma, args);
    }) as any);

    const errors = captureErrors();
    try {
      await processRecurringBilling().catch(() => undefined);
    } finally {
      errors.restore();
    }
    expect(paystackSucceeded).toBe(true);
    expect(charge).toHaveBeenCalledTimes(1);

    // "Restart": remove the fault and run the job again (twice for good measure).
    restorePrismaSpies();
    charge.mockImplementation(defaultCharge as any);
    await processRecurringBilling();
    await processRecurringBilling();

    expect(charge).toHaveBeenCalledTimes(1);
    const txns = await prisma.transaction.findMany({ where: { membershipId: membership.id, type: 'RECURRING' } });
    expect(txns).toHaveLength(1);
  });

  describe('F4: charge.success webhook for a RECURRING reference -> no unique-constraint error, 1 payout', () => {
    it('webhook arrives DURING the job (between chargeAuthorization and the job\'s DB write)', async () => {
      const { membership } = await createDueRecurringMembership();
      const charge = vi.mocked(paystackMocks.chargeAuthorization);
      const defaultCharge = charge.getMockImplementation()!;

      let webhookStatus: number | undefined;
      charge.mockImplementationOnce(async (...args: any[]) => {
        const r = await (defaultCharge as any)(...args);
        // Paystack's webhook lands before the job persists the charge result.
        webhookStatus = (await postWebhook(chargeSuccessPayload(args[3]))).status;
        return r;
      });

      const errors = captureErrors();
      try {
        await processRecurringBilling();
      } finally {
        errors.restore();
      }

      expect(webhookStatus).toBe(200);
      expect(errors.lines.filter((l) => /unique constraint|P2002/i.test(l))).toEqual([]);

      const txns = await prisma.transaction.findMany({ where: { membershipId: membership.id, type: 'RECURRING' } });
      expect(txns).toHaveLength(1);
      expect(txns[0].status).toBe('SUCCESS');
      expect(await prisma.payout.count({ where: { transactionId: txns[0].id } })).toBe(1);
      expect(await prisma.payout.count()).toBe(1);
      expect((await prisma.webhookLog.findUnique({ where: { reference: txns[0].reference } }))!.processed).toBe(true);
    });

    it('webhook arrives AFTER the job completed', async () => {
      const { membership } = await createDueRecurringMembership();
      await processRecurringBilling();

      const txn = await prisma.transaction.findFirstOrThrow({ where: { membershipId: membership.id, type: 'RECURRING' } });
      const mBefore = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
      const payoutBefore = await prisma.payout.findUniqueOrThrow({ where: { transactionId: txn.id } });

      const errors = captureErrors();
      let status: number;
      try {
        status = (await postWebhook(chargeSuccessPayload(txn.reference))).status;
      } finally {
        errors.restore();
      }

      expect(status).toBe(200);
      expect(errors.lines.filter((l) => /unique constraint|P2002/i.test(l))).toEqual([]);
      expect(await prisma.payout.count()).toBe(1);
      expect(await prisma.payout.findUniqueOrThrow({ where: { transactionId: txn.id } })).toEqual(payoutBefore);
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).nextBillingDate).toEqual(
        mBefore.nextBillingDate
      );
    });
  });

  it('F5 per-cycle dunning: 3 declines retry after delay, 4th fails membership & reopens pool, success resets billingAttempts', async () => {
    // (a) & (b): 1-seat FULL pool so we can verify pool reopening on final (4th) failure.
    const { membership, pool } = await createDueRecurringMembership({ totalSeats: 1 });
    await prisma.pool.update({ where: { id: pool.id }, data: { status: 'FULL' } });

    const charge = vi.mocked(paystackMocks.chargeAuthorization);
    const defaultCharge = charge.getMockImplementation();
    expect(defaultCharge).toBeTypeOf('function');
    const mockDecline = async (_a: any, _e: any, amount: any, reference: any) => ({
      status: 'failed',
      reference,
      amount: amount * 100,
      gateway_response: 'Declined',
    });
    charge.mockImplementation(mockDecline as any);

    const expectedRetryDelaysDays = [1, 3, 5];

    // Attempts 1, 2, 3: membership stays ACTIVE, retries scheduled after [1, 3, 5] days.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const before = Date.now();
      await processRecurringBilling();
      const after = Date.now();

      expect(charge).toHaveBeenCalledTimes(attempt);

      const m = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
      expect(m.status).toBe('ACTIVE');
      expect(m.billingAttempts).toBe(attempt);
      expect(m.billingCycleDate).not.toBeNull();

      const delayMs = expectedRetryDelaysDays[attempt - 1] * DAY;
      expect(m.nextBillingDate!.getTime()).toBeGreaterThanOrEqual(before + delayMs - 5000);
      expect(m.nextBillingDate!.getTime()).toBeLessThanOrEqual(after + delayMs + 5000);

      // Running again BEFORE the retry delay elapses must not charge.
      await processRecurringBilling();
      expect(charge).toHaveBeenCalledTimes(attempt);

      // Advance past the retry delay so the next run is due.
      await prisma.membership.update({
        where: { id: membership.id },
        data: { nextBillingDate: new Date(Date.now() - HOUR) },
      });
    }

    // Pool is still FULL after 3 declines.
    expect((await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } })).status).toBe('FULL');

    // Attempt 4 (terminal): membership becomes FAILED, pool reopens to ACTIVE.
    await processRecurringBilling();
    expect(charge).toHaveBeenCalledTimes(4);

    const failedMembership = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(failedMembership.status).toBe('FAILED');
    expect(failedMembership.billingAttempts).toBe(4);
    expect((await prisma.pool.findUniqueOrThrow({ where: { id: pool.id } })).status).toBe('ACTIVE');

    // A further run (even if nextBillingDate is in the past) must make no charge.
    await prisma.membership.update({
      where: { id: membership.id },
      data: { nextBillingDate: new Date(Date.now() - HOUR) },
    });
    await processRecurringBilling();
    expect(charge).toHaveBeenCalledTimes(4);

    // (c) A successful renewal after prior failed attempts resets billingAttempts to 0.
    const second = await createDueRecurringMembership();
    await processRecurringBilling();
    const afterOneDecline = await prisma.membership.findUniqueOrThrow({ where: { id: second.membership.id } });
    expect(afterOneDecline.billingAttempts).toBe(1);
    expect(afterOneDecline.billingCycleDate).not.toBeNull();

    await prisma.membership.update({
      where: { id: second.membership.id },
      data: { nextBillingDate: new Date(Date.now() - HOUR) },
    });
    charge.mockImplementation(defaultCharge! as any);
    await processRecurringBilling();

    const afterSuccess = await prisma.membership.findUniqueOrThrow({ where: { id: second.membership.id } });
    expect(afterSuccess.status).toBe('ACTIVE');
    expect(afterSuccess.billingAttempts).toBe(0);
    expect(afterSuccess.billingCycleDate).toBeNull();
  });

  it('F6: no card on file -> payment-failed email + notification, no charge attempted', async () => {
    const { membership, user } = await createDueRecurringMembership({ withCard: false });

    await processRecurringBilling();

    expect(vi.mocked(paystackMocks.chargeAuthorization)).not.toHaveBeenCalled();
    expect(vi.mocked(emailMocks.sendPaymentFailedEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emailMocks.sendPaymentFailedEmail).mock.calls[0][0]).toBe(user.email);
    expect(await prisma.notification.count({ where: { userId: user.id, type: 'PAYMENT_FAILED' } })).toBe(1);
    expect(await prisma.transaction.count({ where: { membershipId: membership.id } })).toBe(0);
  });

  it.todo('F7: renewals should honour Pool.renewalDay (currently now + 30 days)');
});

