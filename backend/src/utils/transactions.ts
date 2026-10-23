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
