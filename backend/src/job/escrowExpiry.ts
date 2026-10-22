import { prisma } from '../db.js';
import { initiateTransfer, chargeAuthorization } from '../utils/paystack.js';
import {
    sendEscrowReminderEmail,
    sendPayoutConfirmedEmail,
    sendUpcomingBillingEmail,
    sendPaymentFailedEmail,
} from '../utils/email.js';
import { createNotification } from '../utils/notifications.js';

const PLATFORM_FEE_PERCENT = 0.20;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            const isLast = attempt === MAX_RETRIES;
            const msg = err.message?.includes("Can't reach database server")
                ? "Database connection lost (Neon idle timeout)"
                : err.message;

            if (isLast) {
                console.error(`[Cron] ${label} failed after ${MAX_RETRIES} attempts: ${msg}`);
                return null;
            }

            console.warn(`[Cron] ${label} attempt ${attempt} failed: ${msg}. Retrying in ${RETRY_DELAY_MS}ms...`);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
    }
    return null;
}

export async function processExpiredEscrows() {
    await withRetry(async () => {
        const memberships = await prisma.membership.findMany({
            where: {
                status: 'IN_ESCROW',
                escrowEndsAt: { lte: new Date() },
            },
            include: { pool: true },
        });

        for (const m of memberships) {
            await prisma.membership.update({
                where: { id: m.id },
                data: { status: 'ACTIVE' },
            });

            // Natural escrow period has already elapsed; payout is due immediately
            const payoutDueAt = new Date();
            const transaction = await prisma.transaction.findFirst({
                where: { membershipId: m.id, status: 'SUCCESS' },
                include: { payout: true },
            });

            if (transaction && transaction.payout) {
                await prisma.payout.update({
                    where: { id: transaction.payout.id },
                    data: { status: 'SCHEDULED', payoutDueAt },
                });
            }
        }

        if (memberships.length > 0) {
            console.log(`[Cron] Processed ${memberships.length} expired escrows`);
        }
    }, 'Escrow expiry');
}

export async function processEscrowReminders() {
    await withRetry(async () => {
        const now = new Date();
        const reminderWindowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000);
        const reminderWindowEnd = new Date(now.getTime() + 28 * 60 * 60 * 1000);

        const memberships = await prisma.membership.findMany({
            where: {
                status: 'IN_ESCROW',
                escrowEndsAt: {
                    gte: reminderWindowStart,
                    lte: reminderWindowEnd,
                },
            },
            include: {
                pool: true,
                user: { select: { email: true, fullName: true } },
            },
        });

        for (const m of memberships) {
            const hoursLeft = Math.round((m.escrowEndsAt!.getTime() - now.getTime()) / (60 * 60 * 1000));

            const existing = await prisma.notification.findFirst({
                where: {
                    userId: m.userId,
                    type: 'ESCROW_REMINDER',
                    data: { path: ['membershipId'], equals: m.id },
                },
            });

            if (!existing) {
                await sendEscrowReminderEmail(m.user.email, m.user.fullName, m.pool.name, hoursLeft);
                await prisma.notification.create({
                    data: {
                        userId: m.userId,
                        type: 'ESCROW_REMINDER',
                        title: 'Escrow ending soon',
                        message: `Your escrow for "${m.pool.name}" ends in ${hoursLeft} hours. Confirm access or raise a dispute.`,
                        data: { membershipId: m.id, poolId: m.poolId },
                    },
                });
            }
        }

        if (memberships.length > 0) {
            console.log(`[Cron] Sent ${memberships.length} escrow reminders`);
        }
    }, 'Escrow reminders');
}

export async function processUpcomingBillingReminders() {
    await withRetry(async () => {
        const now = new Date();
        const threeDaysAhead = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

        // Find active memberships due in the next 3 days
        const memberships = await prisma.membership.findMany({
            where: {
                status: 'ACTIVE',
                nextBillingDate: {
                    gte: now,
                    lte: threeDaysAhead,
                },
            },
            include: {
                pool: true,
                user: { select: { email: true, fullName: true } },
            },
        });

        for (const m of memberships) {
            // Check if reminder was already sent for this billing period (in the last 15 days)
            const fifteenDaysAgo = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
            const existing = await prisma.notification.findFirst({
                where: {
                    userId: m.userId,
                    type: 'BILLING_REMINDER',
                    createdAt: { gte: fifteenDaysAgo },
                    data: { path: ['membershipId'], equals: m.id },
                },
            });

            if (!existing && m.nextBillingDate) {
                const dueDateFormatted = m.nextBillingDate.toLocaleDateString('en-NG', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                });

                await sendUpcomingBillingEmail(
                    m.user.email,
                    m.user.fullName,
                    m.pool.name,
                    m.pool.pricePerSeat,
                    dueDateFormatted
                );

                await prisma.notification.create({
                    data: {
                        userId: m.userId,
                        type: 'BILLING_REMINDER',
                        title: 'Upcoming subscription renewal',
                        message: `Your subscription for "${m.pool.name}" renews on ${dueDateFormatted} (₦${m.pool.pricePerSeat.toLocaleString()}). Please ensure your card is funded.`,
                        data: { membershipId: m.id, poolId: m.poolId, nextBillingDate: m.nextBillingDate },
                    },
                });
            }
        }

        if (memberships.length > 0) {
            console.log(`[Cron] Processed ${memberships.length} upcoming billing reminders`);
        }
    }, 'Upcoming billing reminders');
}

export async function processScheduledPayouts() {
    await withRetry(async () => {
        const payouts = await prisma.payout.findMany({
            where: {
                status: 'SCHEDULED',
                payoutDueAt: { lte: new Date() },
            },
            include: {
                transaction: true,
                host: { include: { bankAccount: true } },
            },
        });

        for (const payout of payouts) {
            // FIX #16: Skip payout if membership is in dispute
            if (payout.transaction.membershipId) {
                const membership = await prisma.membership.findUnique({
                    where: { id: payout.transaction.membershipId },
                    select: { status: true },
                });

                if (membership?.status === 'DISPUTED') {
                    console.log(`[Payout] Skipping payout ${payout.id} — membership ${payout.transaction.membershipId} is in dispute`);
                    continue;
                }
            }

            const bankAccount = payout.host.bankAccount;
            if (!bankAccount || !bankAccount.verified) {
                await prisma.payout.update({
                    where: { id: payout.id },
                    data: { status: 'FAILED', failureReason: 'No verified bank account' },
                });

                await createNotification({
                    userId: payout.hostId,
                    type: 'BANK_ACCOUNT_REQUIRED',
                    title: 'Bank account required for payout',
                    message: `You have a payout of ₦${payout.amount.toLocaleString()} ready, but have not linked a verified bank account. Please visit Payout Setup to receive your funds.`,
                    data: { payoutId: payout.id, amount: payout.amount },
                });
                continue;
            }

            try {
                const transferRef = `TRF-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
                await initiateTransfer(
                    payout.amount,
                    bankAccount.recipientCode,
                    `Payout for pool subscription`,
                    transferRef
                );
                await prisma.payout.update({
                    where: { id: payout.id },
                    data: { status: 'PROCESSING', transferCode: transferRef },
                });

                const membership = await prisma.membership.findUnique({
                    where: { id: payout.transaction.membershipId! },
                    include: { pool: true },
                });

                if (membership) {
                    await sendPayoutConfirmedEmail(
                        payout.host.email,
                        payout.host.fullName,
                        membership.pool.name,
                        payout.amount
                    );

                    await prisma.notification.create({
                        data: {
                            userId: payout.hostId,
                            type: 'PAYOUT_CONFIRMED',
                            title: 'Payout confirmed',
                            message: `₦${payout.amount.toLocaleString()} has been sent to your bank account for "${membership.pool.name}".`,
                            data: { payoutId: payout.id, poolName: membership.pool.name },
                        },
                    });
                }
            } catch (err: any) {
                await prisma.payout.update({
                    where: { id: payout.id },
                    data: { status: 'FAILED', failureReason: err.message },
                });
            }
        }

        if (payouts.length > 0) {
            console.log(`[Cron] Processed ${payouts.length} scheduled payouts`);
        }
    }, 'Scheduled payouts');
}

export async function processRecurringBilling() {
    await withRetry(async () => {
        const now = new Date();

        const memberships = await prisma.membership.findMany({
            where: {
                status: 'ACTIVE',
                nextBillingDate: { lte: now },
            },
            include: {
                pool: true,
                user: {
                    include: {
                        paymentMethods: {
                            where: { isDefault: true },
                            take: 1,
                        },
                    },
                },
            },
        });

        for (const m of memberships) {
            // FIX #13: Skip if billing date is in the future (not due yet)
            if (m.nextBillingDate && m.nextBillingDate.getTime() > now.getTime()) {
                continue;
            }

            const recentFailures = await prisma.transaction.count({
                where: {
                    membershipId: m.id,
                    type: 'RECURRING',
                    status: 'FAILED',
                    createdAt: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
                },
            });

            if (recentFailures >= 3) {
                await prisma.membership.update({
                    where: { id: m.id },
                    data: { status: 'FAILED' },
                });
                console.error(`[Recurring] Membership ${m.id} cancelled after 3 failed billing attempts`);
                continue;
            }

            // Retrieve card authorization (membership specific or user default)
            const authCode = m.paystackAuthCode || m.user.paymentMethods[0]?.authorizationCode;

            if (!authCode) {
                await sendPaymentFailedEmail(
                    m.user.email,
                    m.user.fullName,
                    m.pool.name,
                    m.pool.pricePerSeat
                );
                await createNotification({
                    userId: m.userId,
                    type: 'PAYMENT_FAILED',
                    title: 'Renewal payment failed',
                    message: `Automatic renewal for "${m.pool.name}" failed: No payment card on file. Please add a debit card in your settings to avoid losing access.`,
                    data: { poolId: m.pool.id, membershipId: m.id },
                });
                continue;
            }

            const reference = `SP-RECUR-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            const amount = m.pool.pricePerSeat;
            const platformFee = Math.floor(amount * PLATFORM_FEE_PERCENT);
            const hostPayout = amount - platformFee;

            try {
                const transaction = await prisma.transaction.create({
                    data: {
                        userId: m.userId,
                        membershipId: m.id,
                        reference,
                        amount,
                        platformFee,
                        hostPayout,
                        status: 'PENDING',
                        type: 'RECURRING',
                    },
                });

                const paystackData = await chargeAuthorization(
                    authCode,
                    m.user.email,
                    amount,
                    reference,
                    { membershipId: m.id, poolId: m.pool.id, type: 'RECURRING' }
                );

                if (paystackData.status === 'success') {
                    await prisma.transaction.update({
                        where: { id: transaction.id },
                        data: {
                            status: 'SUCCESS',
                            paystackData: paystackData as any,
                        },
                    });

                    const nextBillingDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                    await prisma.membership.update({
                        where: { id: m.id },
                        data: { nextBillingDate },
                    });

                    const payoutDueAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
                    await prisma.payout.create({
                        data: {
                            transactionId: transaction.id,
                            hostId: m.pool.hostId,
                            amount: hostPayout,
                            status: 'SCHEDULED',
                            payoutDueAt,
                        },
                    });

                    console.log(`[Recurring] Charged ${m.user.email} ₦${amount} for ${m.pool.name}`);
                } else {
                    await prisma.transaction.update({
                        where: { id: transaction.id },
                        data: { status: 'FAILED', paystackData: paystackData as any },
                    });
                    console.error(`[Recurring] Failed to charge ${m.user.email}: ${paystackData.message}`);

                    await sendPaymentFailedEmail(m.user.email, m.user.fullName, m.pool.name, amount);
                    await createNotification({
                        userId: m.userId,
                        type: 'PAYMENT_FAILED',
                        title: 'Subscription renewal failed',
                        message: `Payment of ₦${amount.toLocaleString()} for "${m.pool.name}" failed: ${paystackData.message || 'Card declined'}. Please update your payment method to maintain access.`,
                        data: { membershipId: m.id, poolId: m.poolId },
                    });
                }
            } catch (err: any) {
                console.error(`[Recurring] Error charging ${m.user.email}:`, err.message);
            }
        }

        if (memberships.length > 0) {
            console.log(`[Cron] Processed ${memberships.length} recurring billing items`);
        }
    }, 'Recurring billing');
}