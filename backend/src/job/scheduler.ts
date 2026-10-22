import {
    processExpiredEscrows,
    processEscrowReminders,
    processUpcomingBillingReminders,
    processScheduledPayouts,
    processRecurringBilling,
} from './escrowExpiry.js';
import { pruneOldNotifications } from '../utils/notifications.js';
import { prisma } from '../db.js';

let isRunning = false;
let lastPrunedAt = 0;

async function runJobs() {
    if (isRunning) {
        console.log('[Cron] Previous job run still in progress, skipping...');
        return;
    }

    isRunning = true;
    console.log('[Cron] Starting job run at', new Date().toISOString());

    try {
        await processExpiredEscrows();
    } catch (err: any) {
        console.error('[Cron] Escrow expiry job failed:', err.message);
    }

    try {
        await processEscrowReminders();
    } catch (err: any) {
        console.error('[Cron] Escrow reminder job failed:', err.message);
    }

    try {
        await processUpcomingBillingReminders();
    } catch (err: any) {
        console.error('[Cron] Upcoming billing reminder job failed:', err.message);
    }

    try {
        await processRecurringBilling();
    } catch (err: any) {
        console.error('[Cron] Recurring billing job failed:', err.message);
    }

    try {
        await processScheduledPayouts();
    } catch (err: any) {
        console.error('[Cron] Scheduled payout job failed:', err.message);
    }

    // Daily notification retention pruning
    if (Date.now() - lastPrunedAt > 24 * 60 * 60 * 1000) {
        try {
            await pruneOldNotifications();
            lastPrunedAt = Date.now();
        } catch (err: any) {
            console.error('[Cron] Notification pruning job failed:', err.message);
        }
    }

    console.log('[Cron] Job run completed at', new Date().toISOString());
    isRunning = false;
}

// Run every 5 minutes
setInterval(runJobs, 5 * 60 * 1000);

// Keep-alive ping loop: runs every 3 minutes to prevent idle connection termination
setInterval(async () => {
    try {
        await prisma.$queryRaw`SELECT 1`;
    } catch (err: any) {
        console.warn('[DB Ping] Keep-alive ping failed:', err.message);
    }
}, 3 * 60 * 1000);

// Also run once on startup (with delay so server is fully ready)
setTimeout(runJobs, 10_000);

export { runJobs };