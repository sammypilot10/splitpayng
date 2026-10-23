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

