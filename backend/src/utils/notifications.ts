import { prisma } from '../db.js';

interface CreateNotificationParams {
    userId: string;
    type: string;
    title: string;
    message: string;
    data?: any;
}

const MAX_NOTIFICATIONS_PER_USER = 100;

/**
 * Creates a notification for a user and enforces a maximum cap of 100 notifications per user
 * by pruning the oldest read notifications when capacity is reached.
 */
export async function createNotification(params: CreateNotificationParams) {
    const notification = await prisma.notification.create({
        data: {
            userId: params.userId,
            type: params.type,
            title: params.title,
            message: params.message,
            data: params.data,
        },
    });

    try {
        const count = await prisma.notification.count({
            where: { userId: params.userId },
        });

        if (count > MAX_NOTIFICATIONS_PER_USER) {
            const excess = count - MAX_NOTIFICATIONS_PER_USER;
            const oldest = await prisma.notification.findMany({
                where: { userId: params.userId },
                orderBy: [
                    { read: 'desc' }, // prioritize deleting read ones first
                    { createdAt: 'asc' }, // oldest first
                ],
                take: excess,
                select: { id: true },
            });

            if (oldest.length > 0) {
                await prisma.notification.deleteMany({
                    where: {
                        id: { in: oldest.map((n) => n.id) },
                    },
                });
            }
        }
    } catch (err: any) {
        console.error('[NotificationService] Failed to enforce user notification cap:', err.message);
    }

    return notification;
}

/**
 * Prunes expired notifications:
 * - Read notifications older than 30 days
 * - Any notifications older than 90 days
 */
export async function pruneOldNotifications() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const readPruned = await prisma.notification.deleteMany({
        where: {
            read: true,
            createdAt: { lt: thirtyDaysAgo },
        },
    });

    const unreadPruned = await prisma.notification.deleteMany({
        where: {
            createdAt: { lt: ninetyDaysAgo },
        },
    });

    if (readPruned.count > 0 || unreadPruned.count > 0) {
        console.log(`[NotificationPruning] Pruned ${readPruned.count} read (>30d) and ${unreadPruned.count} old (>90d) notifications.`);
    }
}
