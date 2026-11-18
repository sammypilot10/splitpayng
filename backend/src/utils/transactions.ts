import { prisma } from '../db.js';

/**
 * Returns the latest SUCCESS transaction of type JOIN for a given membership.
 * Orders by createdAt: 'desc' to ensure active/latest transaction is picked
 * when memberships are reused across cycles or rejoins.
 */
export async function getCurrentJoinTransaction(membershipId: string, client: any = prisma) {
  return client.transaction.findFirst({
    where: {
      membershipId,
      type: 'JOIN',
      status: 'SUCCESS',
    },
    orderBy: { createdAt: 'desc' },
    include: { payout: true },
  });
}

/**
 * Schedules payout for the latest JOIN transaction of a membership atomically.
 * Only transitions payouts that are PENDING or FAILED with 'No verified bank account'.
 * Never overwrites COMPLETED, PROCESSING, or SCHEDULED payouts.
 * Treat count === 0 as "nothing to schedule" (no-op, does not throw).
 */
export async function schedulePayoutForMembership(membershipId: string, dueAt: Date, client: any = prisma) {
  const transaction = await getCurrentJoinTransaction(membershipId, client);
  if (!transaction || !transaction.payout) {
    return { scheduled: false };
  }

  const result = await client.payout.updateMany({
    where: {
      id: transaction.payout.id,
      OR: [
        { status: 'PENDING' },
        { status: 'FAILED', failureReason: 'No verified bank account' },
      ],
    },
    data: {
      status: 'SCHEDULED',
      payoutDueAt: dueAt,
    },
  });

  return { scheduled: result.count === 1, payoutId: transaction.payout.id };
}

/**
 * Atomically transitions a payout to COMPLETED from PROCESSING, SCHEDULED, or FAILED.
 * Dispatches confirmation email and notification only if this invocation performed the transition (count === 1).
 */
export async function completePayout(payoutId: string, client: any = prisma) {
  const updateResult = await client.payout.updateMany({
    where: {
      id: payoutId,
      status: { in: ['PROCESSING', 'SCHEDULED', 'FAILED'] },
    },
    data: {
      status: 'COMPLETED',
      failureReason: null,
    },
  });

  if (updateResult.count === 1) {
    try {
      const payout = await client.payout.findUnique({
        where: { id: payoutId },
        include: {
          host: true,
          transaction: {
            include: {
              membership: {
                include: { pool: true },
              },
            },
          },
        },
      });

      if (payout) {
        const poolName = payout.transaction?.membership?.pool?.name || 'Subscription Pool';

        try {
          const { sendPayoutConfirmedEmail } = await import('./email.js');
          await sendPayoutConfirmedEmail(
            payout.host.email,
            payout.host.fullName,
            poolName,
            payout.amount
          );
        } catch (emailErr: any) {
          console.error(`[Payout] Email delivery error for payout ${payoutId}:`, emailErr.message);
        }

        try {
          await client.notification.create({
            data: {
              userId: payout.hostId,
              type: 'PAYOUT_CONFIRMED',
              title: 'Payout confirmed',
              message: `₦${payout.amount.toLocaleString()} has been sent to your bank account for "${poolName}".`,
              data: { payoutId: payout.id, poolName },
            },
          });
        } catch (notifErr: any) {
          console.error(`[Payout] Notification error for payout ${payoutId}:`, notifErr.message);
        }
      }
    } catch (fetchErr: any) {
      console.error(`[Payout] Error loading details after completing payout ${payoutId}:`, fetchErr.message);
    }
    return { completed: true };
  }
  return { completed: false };
}

// ─── RECURRING BILLING CONSTANTS & HELPERS ─────────────────────────────────

/** Maximum charge attempts per billing cycle before marking membership FAILED. */
export const MAX_BILLING_ATTEMPTS = 4;

/** Retry delays in days after failures 1, 2, 3. The 4th failure is terminal. */
export const BILLING_RETRY_DELAYS_DAYS = [1, 3, 5] as const;

const PLATFORM_FEE_PERCENT = 0.20;

/**
 * Builds a deterministic, per-cycle Paystack reference.
 * Format: REC-{membershipId}-{yyyymmdd(cycleDate)}-{attemptNo}
 */
export function buildRecurringReference(membershipId: string, cycleDate: Date, attemptNo: number): string {
  const yyyymmdd = cycleDate.toISOString().slice(0, 10).replace(/-/g, '');
  return `REC-${membershipId}-${yyyymmdd}-${attemptNo}`;
}

/**
 * Resolves the billing authorization code for a membership.
 * Prefers membership-specific code, falls back to user's default payment method.
 */
export function resolveBillingAuthorization(membership: {
  paystackAuthCode: string | null;
  user: { paymentMethods: { authorizationCode: string }[] };
}): string | null {
  return membership.paystackAuthCode || membership.user.paymentMethods[0]?.authorizationCode || null;
}

/**
 * Atomically completes a recurring charge in one $transaction:
 * 1. Checks membership CANCELLED *before* writing anything
 * 2. If cancelled: marks transaction SUCCESS (money was taken), skips payout, flags for refund
 * 3. If active: marks transaction SUCCESS, resets billing state, upserts payout
 */
export async function completeRecurringCharge(
  reference: string,
  paystackData?: any,
  client: any = prisma,
): Promise<{ completed: boolean; reason?: string }> {
  return client.$transaction(async (tx: any) => {
    const txn = await tx.transaction.findUnique({
      where: { reference },
      include: { membership: { include: { pool: true } } },
    });

    if (!txn || txn.type !== 'RECURRING' || !txn.membershipId) {
      return { completed: false, reason: 'not_found' };
    }

    if (txn.status === 'SUCCESS') {
      return { completed: false, reason: 'already' };
    }

    const membership = txn.membership!;

    // ── NON-ACTIVE CHECK: before writing anything (CANCELLED, FAILED, DISPUTED, etc.) ──
    if (membership.status !== 'ACTIVE') {
      const inactiveUpdate = await tx.transaction.updateMany({
        where: { id: txn.id, status: 'PENDING' },
        data: {
          status: 'SUCCESS',
          ...(paystackData ? { paystackData: paystackData as any } : {}),
        },
      });
      if (inactiveUpdate.count === 1) {
        console.error(
          `[RecurringBilling] REFUND NEEDED: Charged non-active membership ${membership.id} (status: ${membership.status}), ` +
          `transaction ${txn.id}, reference ${reference}. Flagging for refund (Task 06).`,
        );
      }
      // No payout created — money must be refunded
      return { completed: false, reason: 'inactive_refund_pending' };
    }

    // ── NORMAL SUCCESS PATH ───────────────────────────────────────────────
    const updateResult = await tx.transaction.updateMany({
      where: { id: txn.id, status: 'PENDING' },
      data: {
        status: 'SUCCESS',
        ...(paystackData ? { paystackData: paystackData as any } : {}),
      },
    });

    if (updateResult.count !== 1) {
      return { completed: false, reason: 'race' };
    }

    // Compute next billing date: cycleDate + 30d, or now + 30d if already past
    const cycleDate = membership.billingCycleDate || membership.nextBillingDate;
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    let nextBillingDate: Date;
    if (cycleDate) {
      const cyclePlus30 = new Date(cycleDate.getTime() + THIRTY_DAYS_MS);
      nextBillingDate = cyclePlus30.getTime() > Date.now()
        ? cyclePlus30
        : new Date(Date.now() + THIRTY_DAYS_MS);
    } else {
      nextBillingDate = new Date(Date.now() + THIRTY_DAYS_MS);
    }

    // Reset membership billing state
    await tx.membership.update({
      where: { id: membership.id },
      data: {
        nextBillingDate,
        billingAttempts: 0,
        billingCycleDate: null,
      },
    });

    // Upsert payout (SCHEDULED, due +48h)
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    const payoutDueAt = new Date(Date.now() + FORTY_EIGHT_HOURS_MS);
    await tx.payout.upsert({
      where: { transactionId: txn.id },
      update: {},
      create: {
        transactionId: txn.id,
        hostId: membership.pool.hostId,
        amount: txn.hostPayout,
        status: 'SCHEDULED',
        payoutDueAt,
      },
    });

    return { completed: true };
  });
}

/**
 * Atomically fails a recurring charge in one $transaction:
 * 1. Conditional PENDING → FAILED on the transaction (updateMany guard)
 * 2. Only if count === 1: increments billingAttempts, sets billingCycleDate, moves nextBillingDate
 * 3. On final failure (>= MAX_BILLING_ATTEMPTS): sets membership FAILED, reopens pool with row lock
 *
 * Returns { failed, finalFailure, membershipId, userId, pool } for the caller to send notifications.
 */
export async function failRecurringCharge(
  reference: string,
  reason: string,
  paystackData?: any,
  client: any = prisma,
): Promise<{
  failed: boolean;
  finalFailure: boolean;
  membershipId?: string;
  userId?: string;
  pool?: any;
}> {
  return client.$transaction(async (tx: any) => {
    // 1. Conditional PENDING → FAILED
    const result = await tx.transaction.updateMany({
      where: { reference, status: 'PENDING', type: 'RECURRING' },
      data: {
        status: 'FAILED',
        ...(paystackData ? { paystackData: paystackData as any } : {}),
      },
    });

    if (result.count !== 1) return { failed: false, finalFailure: false };

    // 2. Load transaction for membership context
    const txn = await tx.transaction.findUnique({
      where: { reference },
      include: { membership: { include: { pool: true } } },
    });

    if (!txn?.membershipId || !txn.membership) return { failed: true, finalFailure: false };

    const membership = txn.membership;
    const newAttempts = membership.billingAttempts + 1;
    const cycleDate = membership.billingCycleDate ?? membership.nextBillingDate;

    if (newAttempts >= MAX_BILLING_ATTEMPTS) {
      // ── FINAL FAILURE ─────────────────────────────────────────────────
      await tx.membership.update({
        where: { id: membership.id },
        data: { status: 'FAILED', billingAttempts: newAttempts },
      });

      // Pool reopening: take row lock, re-read pool, recount, reopen only if FULL and seat freed
      await tx.$queryRaw`SELECT id FROM "Pool" WHERE id = ${membership.poolId} FOR UPDATE`;
      const pool = await tx.pool.findUnique({ where: { id: membership.poolId } });
      const validSeats = await tx.membership.count({
        where: {
          poolId: membership.poolId,
          status: { in: ['ACTIVE', 'IN_ESCROW', 'DISPUTED'] },
        },
      });
      if (pool && pool.status === 'FULL' && validSeats < pool.totalSeats) {
        await tx.pool.update({
          where: { id: membership.poolId },
          data: { status: 'ACTIVE' },
        });
      }

      return {
        failed: true,
        finalFailure: true,
        membershipId: membership.id,
        userId: membership.userId,
        pool: pool || membership.pool,
      };
    } else {
      // ── RETRY ─────────────────────────────────────────────────────────
      const retryDays = BILLING_RETRY_DELAYS_DAYS[newAttempts - 1]
        ?? BILLING_RETRY_DELAYS_DAYS[BILLING_RETRY_DELAYS_DAYS.length - 1];
      const nextBillingDate = new Date(Date.now() + retryDays * 24 * 60 * 60 * 1000);

      await tx.membership.update({
        where: { id: membership.id },
        data: {
          billingAttempts: newAttempts,
          billingCycleDate: cycleDate,
          nextBillingDate,
        },
      });

      return {
        failed: true,
        finalFailure: false,
        membershipId: membership.id,
        userId: membership.userId,
        pool: membership.pool,
      };
    }
  });
}

/**
 * Records a billing failure when a member has no payment card on file.
 * Advances through the exact same retry schedule (+1d, +3d, +5d, final failure after 4th)
 * via conditional update on Membership (no transaction row created).
 */
export async function failNoPaymentMethod(
  membershipId: string,
  client: any = prisma,
): Promise<{
  failed: boolean;
  finalFailure: boolean;
  membership?: any;
  nextBillingDate?: Date;
  attemptNo: number;
}> {
  return client.$transaction(async (tx: any) => {
    const membership = await tx.membership.findUnique({
      where: { id: membershipId },
      include: { pool: true, user: { select: { email: true, fullName: true } } },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      return { failed: false, finalFailure: false, attemptNo: 0 };
    }

    const newAttempts = membership.billingAttempts + 1;
    const cycleDate = membership.billingCycleDate ?? membership.nextBillingDate;

    if (newAttempts >= MAX_BILLING_ATTEMPTS) {
      // ── FINAL FAILURE ─────────────────────────────────────────────────
      const updateResult = await tx.membership.updateMany({
        where: { id: membership.id, status: 'ACTIVE', billingAttempts: membership.billingAttempts },
        data: { status: 'FAILED', billingAttempts: newAttempts },
      });

      if (updateResult.count !== 1) {
        return { failed: false, finalFailure: false, attemptNo: 0 };
      }

      // Pool reopening: take row lock, re-read pool, recount, reopen only if FULL and seat freed
      await tx.$queryRaw`SELECT id FROM "Pool" WHERE id = ${membership.poolId} FOR UPDATE`;
      const pool = await tx.pool.findUnique({ where: { id: membership.poolId } });
      const validSeats = await tx.membership.count({
        where: {
          poolId: membership.poolId,
          status: { in: ['ACTIVE', 'IN_ESCROW', 'DISPUTED'] },
        },
      });
      if (pool && pool.status === 'FULL' && validSeats < pool.totalSeats) {
        await tx.pool.update({
          where: { id: membership.poolId },
          data: { status: 'ACTIVE' },
        });
      }

      return {
        failed: true,
        finalFailure: true,
        membership,
        attemptNo: newAttempts,
      };
    } else {
      // ── RETRY ─────────────────────────────────────────────────────────
      const retryDays = BILLING_RETRY_DELAYS_DAYS[newAttempts - 1]
        ?? BILLING_RETRY_DELAYS_DAYS[BILLING_RETRY_DELAYS_DAYS.length - 1];
      const nextBillingDate = new Date(Date.now() + retryDays * 24 * 60 * 60 * 1000);

      const updateResult = await tx.membership.updateMany({
        where: { id: membership.id, status: 'ACTIVE', billingAttempts: membership.billingAttempts },
        data: {
          billingAttempts: newAttempts,
          billingCycleDate: cycleDate,
          nextBillingDate,
        },
      });

      if (updateResult.count !== 1) {
        return { failed: false, finalFailure: false, attemptNo: 0 };
      }

      return {
        failed: true,
        finalFailure: false,
        membership,
        nextBillingDate,
        attemptNo: newAttempts,
      };
    }
  });
}

