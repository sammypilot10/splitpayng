import { randomUUID } from 'crypto';
import { prisma } from '../db.js';
import {
    initiateTransfer,
    chargeAuthorization,
    verifyTransfer,
    verifyTransaction,
    classifyPaystackError,
} from '../utils/paystack.js';
import {
    sendEscrowReminderEmail,
    sendPayoutConfirmedEmail,
    sendUpcomingBillingEmail,
    sendPaymentFailedEmail,
} from '../utils/email.js';
import { createNotification } from '../utils/notifications.js';
import {
    schedulePayoutForMembership,
    completePayout,
    completeRecurringCharge,
    failRecurringCharge,
    failNoPaymentMethod,
    resolveBillingAuthorization,
    buildRecurringReference,
    MAX_BILLING_ATTEMPTS,
} from '../utils/transactions.js';

const PLATFORM_FEE_PERCENT = 0.20;
export const loggedOtpPayoutIds = new Set<string>();
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function isPrismaConnectionError(err: any): boolean {
    if (!err) return false;
    const code = err.code;
    if (code === 'P1001' || code === 'P1002' || code === 'P1017') return true;
    const msg = err.message || '';
    if (msg.includes("Can't reach database server") || msg.includes('Connection lost') || msg.includes('connection timed out')) {
        return true;
    }
    return false;
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            if (!isPrismaConnectionError(err)) {
                console.error(`[Cron] ${label} encountered non-retryable error: ${err.message}`);
                throw err;
            }
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
            await prisma.$transaction(async (tx) => {
                const updated = await tx.membership.updateMany({
                    where: { id: m.id, status: 'IN_ESCROW' },
                    data: { status: 'ACTIVE' },
                });

                if (updated.count !== 1) {
                    return;
                }

                // Natural escrow period has already elapsed; payout is due immediately
                const payoutDueAt = new Date();
                await schedulePayoutForMembership(m.id, payoutDueAt, tx);
            });
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
                const failResult = await prisma.payout.updateMany({
                    where: { id: payout.id, status: 'SCHEDULED' },
                    data: { status: 'FAILED', failureReason: 'No verified bank account' },
                });

                if (failResult.count === 1) {
                    await createNotification({
                        userId: payout.hostId,
                        type: 'BANK_ACCOUNT_REQUIRED',
                        title: 'Bank account required for payout',
                        message: `You have a payout of ₦${payout.amount.toLocaleString()} ready, but have not linked a verified bank account. Please visit Payout Setup to receive your funds.`,
                        data: { payoutId: payout.id, amount: payout.amount },
                    });
                }
                continue;
            }

            // Claim first atomically: generate ref and persist before calling Paystack
            const transferRef = payout.transferCode || `TRF-${Date.now()}-${randomUUID()}`;
            const claim = await prisma.payout.updateMany({
                where: { id: payout.id, status: 'SCHEDULED' },
                data: { status: 'PROCESSING', transferCode: transferRef },
            });

            if (claim.count !== 1) {
                continue; // Already claimed or processed concurrently
            }

            try {
                await initiateTransfer(
                    payout.amount,
                    bankAccount.recipientCode,
                    `Payout for pool subscription`,
                    transferRef
                );
                // Note: Do NOT notify here. Payout is in PROCESSING.
                // Notifications and emails are dispatched only on COMPLETED (via webhook or reconciliation).
            } catch (err: any) {
                const classification = classifyPaystackError(err);
                console.error(`[Payout] Transfer error for payout ${payout.id} (${classification}):`, err.message);

                if (classification === 'DUPLICATE_REFERENCE') {
                    console.warn(`[Payout] Duplicate reference detected for payout ${payout.id} (${transferRef}). Verifying with Paystack...`);
                    try {
                        const transfer = await verifyTransfer(transferRef);
                        const status = (transfer?.status || '').toLowerCase();
                        if (status === 'success') {
                            await completePayout(payout.id, prisma);
                        } else if (status === 'failed' || status === 'reversed') {
                            const reason = transfer?.failure_reason || transfer?.reason || 'Transfer failed or reversed by bank';
                            await prisma.payout.updateMany({
                                where: { id: payout.id, status: 'PROCESSING' },
                                data: { status: 'FAILED', failureReason: reason, transferCode: null },
                            });
                        } else {
                            console.log(`[Payout] Duplicate reference transfer ${transferRef} is currently '${status}'. Leaving in PROCESSING.`);
                        }
                    } catch (verifyErr: any) {
                        console.warn(`[Payout] Could not verify duplicate reference ${transferRef}: ${verifyErr.message}. Leaving in PROCESSING.`);
                    }
                } else if (classification === 'DEFINITELY_NOT_CREATED') {
                    const now = Date.now();
                    const firstAttempt = payout.firstAttemptAt ? payout.firstAttemptAt.getTime() : now;
                    const elapsedMs = now - firstAttempt;
                    const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

                    if (elapsedMs >= FOUR_DAYS_MS) {
                        await prisma.payout.updateMany({
                            where: { id: payout.id, status: 'PROCESSING', transferCode: transferRef },
                            data: {
                                status: 'FAILED',
                                failureReason: `Payout transfer window expired after 4 days of retries: ${err.message}`,
                                transferCode: null,
                            },
                        });

                        // Notify admin at final failure
                        try {
                            const admins = await prisma.user.findMany({
                                where: { role: 'ADMIN' },
                                select: { id: true },
                            });
                            for (const admin of admins) {
                                await createNotification({
                                    userId: admin.id,
                                    type: 'ADMIN_PAYOUT_FAILED',
                                    title: 'Payout Failed - Retry Window Expired (4 Days)',
                                    message: `Payout ${payout.id} (₦${payout.amount.toLocaleString()}) for host ${payout.hostId} failed after 4 days: ${err.message}`,
                                    data: { payoutId: payout.id, hostId: payout.hostId, amount: payout.amount, error: err.message },
                                });
                            }
                        } catch (notifyErr: any) {
                            console.error('[Payout] Error notifying admins of expired payout:', notifyErr.message);
                        }
                    } else {
                        const newAttempts = (payout.attempts || 0) + 1;
                        // Exponential backoff up to ~6 hours (360 minutes)
                        const backoffMinutes = Math.min(360, Math.pow(2, Math.min(newAttempts, 6)) * 5);
                        const nextDueAt = new Date(now + backoffMinutes * 60 * 1000);

                        await prisma.payout.updateMany({
                            where: { id: payout.id, status: 'PROCESSING', transferCode: transferRef },
                            data: {
                                status: 'SCHEDULED',
                                payoutDueAt: nextDueAt,
                                attempts: { increment: 1 },
                                firstAttemptAt: payout.firstAttemptAt || new Date(firstAttempt),
                            },
                        });

                        // Global 24h throttle for shortfall alert + stop payout loop for this run
                        const msgLower = (err.message || '').toLowerCase();
                        const isShortfall = msgLower.includes('balance');
                        if (isShortfall) {
                            const ONE_DAY_MS = 24 * 60 * 60 * 1000;
                            const twentyFourHoursAgo = new Date(now - ONE_DAY_MS);
                            const existingAlert = await prisma.notification.findFirst({
                                where: {
                                    type: 'ADMIN_BALANCE_SHORTFALL',
                                    createdAt: { gte: twentyFourHoursAgo },
                                },
                            });

                            if (!existingAlert) {
                                try {
                                    const admins = await prisma.user.findMany({
                                        where: { role: 'ADMIN' },
                                        select: { id: true },
                                    });
                                    for (const admin of admins) {
                                        await createNotification({
                                            userId: admin.id,
                                            type: 'ADMIN_BALANCE_SHORTFALL',
                                            title: 'Paystack Balance Shortfall',
                                            message: `Insufficient balance to disburse payout ${payout.id} (₦${payout.amount.toLocaleString()}). Please fund your Paystack balance.`,
                                            data: { payoutId: payout.id, amount: payout.amount, error: err.message },
                                        });
                                    }
                                } catch (alertErr: any) {
                                    console.error('[Payout] Error alerting admin of balance shortfall:', alertErr.message);
                                }
                            }

                            console.warn(`[Payout] Balance shortfall detected on payout ${payout.id}. Stopping payout loop for this run.`);
                            break;
                        }
                    }
                } else if (classification === 'PERMANENT') {
                    await prisma.payout.updateMany({
                        where: { id: payout.id, status: 'PROCESSING', transferCode: transferRef },
                        data: {
                            status: 'FAILED',
                            failureReason: err.message,
                            transferCode: null,
                        },
                    });
                } else {
                    // POSSIBLY_CREATED (5xx, 408, timeout, network error): Leave in PROCESSING!
                    console.warn(`[Payout] Payout ${payout.id} left in PROCESSING due to possibly-created error: ${err.message}. Reconcile will verify.`);
                }
            }
        }

        if (payouts.length > 0) {
            console.log(`[Cron] Processed ${payouts.length} scheduled payouts`);
        }
    }, 'Scheduled payouts');
}

export async function reconcilePendingTransfers() {
    await withRetry(async () => {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
        const pendingPayouts = await prisma.payout.findMany({
            where: {
                status: 'PROCESSING',
                transferCode: { not: null },
                updatedAt: { lte: fifteenMinutesAgo },
            },
            include: {
                host: true,
                transaction: true,
            },
        });

        for (const payout of pendingPayouts) {
            const ref = payout.transferCode!;
            try {
                const transfer = await verifyTransfer(ref);
                const status = (transfer?.status || '').toLowerCase();

                if (status === 'success') {
                    await completePayout(payout.id, prisma);
                } else if (status === 'failed' || status === 'reversed') {
                    const reason = transfer?.failure_reason || transfer?.reason || 'Transfer failed or reversed by bank';
                    await prisma.payout.updateMany({
                        where: { id: payout.id, status: 'PROCESSING' },
                        data: { status: 'FAILED', failureReason: reason, transferCode: null },
                    });
                } else if (status === 'otp') {
                    if (!loggedOtpPayoutIds.has(payout.id)) {
                        loggedOtpPayoutIds.add(payout.id);
                        console.error(`[Payout] CRITICAL: Paystack transfer requires OTP! Ref: ${ref}. Payout ${payout.id} stays PROCESSING.`);
                    }
                } else {
                    console.log(`[Reconcile] Transfer ${ref} is currently '${status}' on Paystack. Leaving in PROCESSING.`);
                }
            } catch (err: any) {
                if (err.status === 404 || err.message?.toLowerCase().includes('not found')) {
                    console.warn(`[Reconcile] Transfer ${ref} not found on Paystack (404). Returning payout ${payout.id} to SCHEDULED.`);
                    await prisma.payout.updateMany({
                        where: { id: payout.id, status: 'PROCESSING' },
                        data: { status: 'SCHEDULED' },
                    });
                } else {
                    console.warn(`[Reconcile] Network/transient error verifying transfer ${ref}: ${err.message}. Leaving in PROCESSING.`);
                }
            }
        }

        if (pendingPayouts.length > 0) {
            console.log(`[Cron] Reconciled ${pendingPayouts.length} pending payouts`);
        }
    }, 'Reconcile pending transfers');
}

export async function processRecurringBilling() {
    await withRetry(async () => {
        const now = new Date();

        const memberships = await prisma.membership.findMany({
            where: {
                status: 'ACTIVE',
                billingAttempts: { lt: MAX_BILLING_ATTEMPTS },
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
            try {
                // Resolve card authorization
                const authCode = resolveBillingAuthorization(m);

                if (!authCode) {
                    const noCardResult = await failNoPaymentMethod(m.id);
                    if (noCardResult.failed) {
                        try {
                            await sendPaymentFailedEmail(
                                m.user.email,
                                m.user.fullName,
                                m.pool.name,
                                m.pool.pricePerSeat,
                            );
                            await createNotification({
                                userId: m.userId,
                                type: 'PAYMENT_FAILED',
                                title: 'Renewal payment failed',
                                message: `Automatic renewal for "${m.pool.name}" failed: No payment card on file. ${noCardResult.finalFailure ? 'Your membership status is now FAILED.' : 'Please add a debit card in your settings to avoid losing access.'}`,
                                data: { poolId: m.pool.id, membershipId: m.id },
                            });
                        } catch (notifyErr: any) {
                            console.error(`[Recurring] Notification error for ${m.id}:`, notifyErr.message);
                        }

                        if (noCardResult.finalFailure) {
                            try {
                                await createNotification({
                                    userId: m.pool.hostId,
                                    type: 'MEMBER_BILLING_FAILED',
                                    title: 'Member billing failed',
                                    message: `Billing for a member in "${m.pool.name}" failed after ${MAX_BILLING_ATTEMPTS} attempts due to no payment card on file. The membership status is now FAILED.`,
                                    data: { membershipId: m.id, poolId: m.poolId },
                                });
                            } catch (hostNotifyErr: any) {
                                console.error(`[Recurring] Host notification error for ${m.id}:`, hostNotifyErr.message);
                            }
                        }
                    }
                    continue;
                }

                // Deterministic reference: REC-{membershipId}-{yyyymmdd(cycleDate)}-{attemptNo}
                const cycleDate = m.billingCycleDate ?? m.nextBillingDate!;
                const attemptNo = m.billingAttempts + 1;
                const reference = buildRecurringReference(m.id, cycleDate, attemptNo);

                const amount = m.pool.pricePerSeat;
                const platformFee = Math.floor(amount * PLATFORM_FEE_PERCENT);
                const hostPayout = amount - platformFee;

                // Claim the attempt slot — P2002 on unique reference = concurrent cron, skip
                try {
                    await prisma.transaction.create({
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
                } catch (err: any) {
                    if (err.code === 'P2002') {
                        console.log(`[Recurring] Reference ${reference} already claimed, skipping`);
                        continue;
                    }
                    throw err;
                }

                try {
                    const paystackData = await chargeAuthorization(
                        authCode,
                        m.user.email,
                        amount,
                        reference,
                        { membershipId: m.id, poolId: m.pool.id, type: 'RECURRING' }
                    );

                    if (paystackData.status === 'success') {
                        await completeRecurringCharge(reference, paystackData);
                        console.log(`[Recurring] Charged ${m.user.email} ₦${amount} for ${m.pool.name}`);
                    } else if (['pending', 'send_pin', 'ongoing'].includes(paystackData.status)) {
                        // Paystack is still processing — leave PENDING
                        console.log(`[Recurring] Charge for ${reference} is '${paystackData.status}'. Leaving PENDING.`);
                    } else {
                        // Declined
                        const reason = paystackData.gateway_response || paystackData.message || 'Card declined';
                        const result = await failRecurringCharge(reference, reason, paystackData);

                        if (result.failed) {
                            // Notify member on every decline
                            try {
                                await sendPaymentFailedEmail(m.user.email, m.user.fullName, m.pool.name, amount);
                                await createNotification({
                                    userId: m.userId,
                                    type: 'PAYMENT_FAILED',
                                    title: 'Subscription renewal failed',
                                    message: `Payment of ₦${amount.toLocaleString()} for "${m.pool.name}" failed: ${reason}. ${result.finalFailure ? 'Your membership status is now FAILED.' : 'We will retry automatically.'}`,
                                    data: { membershipId: m.id, poolId: m.poolId },
                                });
                            } catch (notifyErr: any) {
                                console.error(`[Recurring] Member notification error for ${reference}:`, notifyErr.message);
                            }

                            if (result.finalFailure) {
                                // Notify host (side effect after commit, wrapped safely)
                                try {
                                    await createNotification({
                                        userId: m.pool.hostId,
                                        type: 'MEMBER_BILLING_FAILED',
                                        title: 'Member billing failed',
                                        message: `Billing for a member in "${m.pool.name}" failed after ${MAX_BILLING_ATTEMPTS} attempts. The membership status is now FAILED.`,
                                        data: { membershipId: m.id, poolId: m.poolId },
                                    });
                                } catch (hostNotifyErr: any) {
                                    console.error(`[Recurring] Host notification error for ${reference}:`, hostNotifyErr.message);
                                }
                            }
                        }
                    }
                } catch (err: any) {
                    const classification = classifyPaystackError(err);
                    if (classification === 'PERMANENT') {
                        // Definite 4xx (invalid or expired authorization, etc.) — count as decline!
                        const reason = err.message || 'Payment card authorization failed';
                        const result = await failRecurringCharge(reference, reason, err.data);

                        if (result.failed) {
                            try {
                                await sendPaymentFailedEmail(m.user.email, m.user.fullName, m.pool.name, amount);
                                await createNotification({
                                    userId: m.userId,
                                    type: 'PAYMENT_FAILED',
                                    title: 'Subscription renewal failed',
                                    message: `Payment of ₦${amount.toLocaleString()} for "${m.pool.name}" failed: ${reason}. ${result.finalFailure ? 'Your membership status is now FAILED.' : 'We will retry automatically.'}`,
                                    data: { membershipId: m.id, poolId: m.poolId },
                                });
                            } catch (notifyErr: any) {
                                console.error(`[Recurring] Member notification error for ${reference}:`, notifyErr.message);
                            }

                            if (result.finalFailure) {
                                try {
                                    await createNotification({
                                        userId: m.pool.hostId,
                                        type: 'MEMBER_BILLING_FAILED',
                                        title: 'Member billing failed',
                                        message: `Billing for a member in "${m.pool.name}" failed after ${MAX_BILLING_ATTEMPTS} attempts. The membership status is now FAILED.`,
                                        data: { membershipId: m.id, poolId: m.poolId },
                                    });
                                } catch (hostNotifyErr: any) {
                                    console.error(`[Recurring] Host notification error for ${reference}:`, hostNotifyErr.message);
                                }
                            }
                        }
                    } else {
                        // Network/Paystack transient error (5xx, timeout) — leave PENDING for reconcile
                        console.error(`[Recurring] Transient/possibly-created error charging ${m.user.email} (${classification}):`, err.message);
                    }
                }
            } catch (loopErr: any) {
                // Per-membership error isolation: one failure does not halt the loop
                console.error(`[Recurring] Unexpected error processing membership ${m.id}:`, loopErr.message);
            }
        }

        if (memberships.length > 0) {
            console.log(`[Cron] Processed ${memberships.length} recurring billing items`);
        }
    }, 'Recurring billing');
}

/**
 * Reconciles RECURRING transactions stuck in PENDING for over 15 minutes.
 * - Verify success on Paystack → completeRecurringCharge
 * - Verify failed → failRecurringCharge
 * - Verify 404 → delete PENDING transaction (free the reference slot for retry)
 * - Verify network error → leave PENDING
 */
export async function reconcilePendingRecurringCharges() {
    await withRetry(async () => {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

        const pendingTransactions = await prisma.transaction.findMany({
            where: {
                type: 'RECURRING',
                status: 'PENDING',
                createdAt: { lte: fifteenMinutesAgo },
            },
            include: {
                membership: {
                    include: {
                        pool: true,
                        user: { select: { email: true, fullName: true } },
                    },
                },
            },
        });

        for (const txn of pendingTransactions) {
            try {
                const paystackData = await verifyTransaction(txn.reference);
                const status = (paystackData?.status || '').toLowerCase();

                if (status === 'success') {
                    await completeRecurringCharge(txn.reference, paystackData);
                    console.log(`[Reconcile] Recurring charge ${txn.reference} verified as success.`);
                } else if (status === 'failed') {
                    const reason = paystackData?.gateway_response || 'Card declined (verified by reconciliation)';
                    const result = await failRecurringCharge(txn.reference, reason, paystackData);

                    if (result.failed && txn.membership) {
                        // Notify member on decline (side effects wrapped safely)
                        try {
                            await sendPaymentFailedEmail(
                                txn.membership.user.email,
                                txn.membership.user.fullName,
                                txn.membership.pool.name,
                                txn.amount,
                            );
                            await createNotification({
                                userId: txn.membership.userId,
                                type: 'PAYMENT_FAILED',
                                title: 'Subscription renewal failed',
                                message: `Payment of ₦${txn.amount.toLocaleString()} for "${txn.membership.pool.name}" failed: ${reason}.`,
                                data: { membershipId: txn.membership.id, poolId: txn.membership.poolId },
                            });

                            if (result.finalFailure) {
                                await createNotification({
                                    userId: txn.membership.pool.hostId,
                                    type: 'MEMBER_BILLING_FAILED',
                                    title: 'Member billing failed',
                                    message: `Billing for a member in "${txn.membership.pool.name}" failed after ${MAX_BILLING_ATTEMPTS} attempts. The membership has been cancelled.`,
                                    data: { membershipId: txn.membership.id, poolId: txn.membership.poolId },
                                });
                            }
                        } catch (notifyErr: any) {
                            console.error(`[Reconcile] Notification error for ${txn.reference}:`, notifyErr.message);
                        }
                    }
                } else if (['pending', 'send_pin', 'ongoing'].includes(status)) {
                    console.log(`[Reconcile] Recurring charge ${txn.reference} is '${status}'. Leaving PENDING.`);
                }
            } catch (err: any) {
                if (err.status === 404 || err.message?.toLowerCase().includes('not found')) {
                    // Verify 404: delete the PENDING transaction to free the reference slot
                    console.warn(`[Reconcile] Recurring charge ${txn.reference} not found on Paystack (404). Deleting PENDING transaction to free reference slot.`);
                    await prisma.transaction.deleteMany({
                        where: { id: txn.id, status: 'PENDING' },
                    });
                } else {
                    // Network error — leave PENDING
                    console.warn(`[Reconcile] Error verifying recurring charge ${txn.reference}: ${err.message}. Leaving PENDING.`);
                }
            }
        }

        if (pendingTransactions.length > 0) {
            console.log(`[Cron] Reconciled ${pendingTransactions.length} pending recurring charges`);
        }
    }, 'Reconcile pending recurring charges');
}