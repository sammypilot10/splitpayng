import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createPoolSchema, updateCredentialsSchema, idParamSchema } from '../validation/index.js';
import { sendCredentialsRotatedEmail } from '../utils/email.js';
import { createNotification } from '../utils/notifications.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type { ApiResponse } from '../types.js';

const router = Router();

async function countValidSeats(poolId: string): Promise<number> {
    return prisma.membership.count({
        where: {
            poolId,
            status: { in: ['ACTIVE', 'IN_ESCROW', 'DISPUTED'] },
        },
    });
}

function getEscrowHours(hostReputation: { reputationScore: number; successfulPools: number }) {
    const isNewHost = hostReputation.reputationScore < 26 || hostReputation.successfulPools === 0;
    return isNewHost ? 168 : 48; // 7 days vs 2 days
}

router.get('/', async (_req, res, next) => {
    try {
        const pools = await prisma.pool.findMany({
            where: { status: { in: ['ACTIVE', 'FULL'] }, poolType: 'PUBLIC' },
            include: {
                host: {
                    select: {
                        fullName: true,
                        reputationScore: true,
                        successfulPools: true,
                        totalDisputes: true,
                        totalMembersServed: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        const formatted = await Promise.all(
            pools.map(async (pool) => {
                const seatsTaken = await countValidSeats(pool.id);
                const escrowHours = getEscrowHours(pool.host);
                return {
                    id: pool.id,
                    hostId: pool.hostId,
                    name: pool.name,
                    category: pool.category,
                    poolType: pool.poolType,
                    totalSeats: pool.totalSeats,
                    pricePerSeat: pool.pricePerSeat,
                    renewalDay: pool.renewalDay,
                    status: pool.status,
                    createdAt: pool.createdAt.toISOString(),
                    seatsTaken,
                    seatsAvailable: pool.totalSeats - seatsTaken,
                    hostName: pool.host.fullName,
                    escrowHours,
                    hostReputation: {
                        score: pool.host.reputationScore,
                        successfulPools: pool.host.successfulPools,
                        totalDisputes: pool.host.totalDisputes,
                        totalMembersServed: pool.host.totalMembersServed,
                    },
                };
            })
        );

        res.json({ success: true, data: formatted });
    } catch (error) {
        next(error);
    }
});

router.get('/:id', async (req, res, next) => {
    try {
        const pool = await prisma.pool.findUnique({
            where: { id: req.params.id },
            include: {
                host: {
                    select: {
                        fullName: true,
                        reputationScore: true,
                        successfulPools: true,
                        totalDisputes: true,
                        totalMembersServed: true,
                    },
                },
            },
        });

        if (!pool) {
            res.status(404).json({ success: false, message: 'Pool not found' });
            return;
        }

        const seatsTaken = await countValidSeats(pool.id);
        const escrowHours = getEscrowHours(pool.host);

        res.json({
            success: true,
            data: {
                id: pool.id,
                hostId: pool.hostId,
                name: pool.name,
                category: pool.category,
                poolType: pool.poolType,
                totalSeats: pool.totalSeats,
                pricePerSeat: pool.pricePerSeat,
                renewalDay: pool.renewalDay,
                status: pool.status,
                createdAt: pool.createdAt.toISOString(),
                seatsTaken,
                seatsAvailable: pool.totalSeats - seatsTaken,
                hostName: pool.host.fullName,
                escrowHours,
                hostReputation: {
                    score: pool.host.reputationScore,
                    successfulPools: pool.host.successfulPools,
                    totalDisputes: pool.host.totalDisputes,
                    totalMembersServed: pool.host.totalMembersServed,
                },
            },
        });
    } catch (error) {
        next(error);
    }
});

router.post('/', authMiddleware, validate({ body: createPoolSchema }), async (req: AuthenticatedRequest, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { emailVerified: true, hostSince: true },
        });

        if (!user?.emailVerified) {
            res.status(403).json({
                success: false,
                message: 'Please verify your email before creating a pool. Check your inbox or request a new verification email.',
                code: 'EMAIL_NOT_VERIFIED',
            });
            return;
        }

        if (!user.hostSince) {
            await prisma.user.update({
                where: { id: req.user.id },
                data: { hostSince: new Date() },
            });
        }

        const { name, category, totalSeats, pricePerSeat, renewalDay, encryptedCredentials } = req.body;

        const pool = await prisma.pool.create({
            data: {
                hostId: req.user.id,
                name,
                category,
                poolType: req.body.poolType || 'PUBLIC',
                totalSeats,
                pricePerSeat,
                renewalDay: renewalDay ?? 1,
                encryptedCredentials,
                status: 'ACTIVE',
            },
        });

        res.status(201).json({
            success: true,
            data: {
                id: pool.id,
                name: pool.name,
                totalSeats: pool.totalSeats,
                pricePerSeat: pool.pricePerSeat,
                status: pool.status,
                createdAt: pool.createdAt.toISOString(),
                seatsTaken: 0,
                seatsAvailable: pool.totalSeats,
            },
        });
    } catch (error) {
        next(error);
    }
});

router.get('/dashboard-stats', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }

        const pools = await prisma.pool.findMany({
            where: { hostId: req.user.id },
            include: {
                memberships: {
                    where: {
                        status: { in: ['ACTIVE', 'IN_ESCROW', 'DISPUTED'] },
                    },
                    select: { id: true },
                },
            },
        });

        const totalPools = pools.length;
        const totalMembers = pools.reduce((sum, p) => sum + p.memberships.length, 0);
        const monthlyRevenue = pools.reduce(
            (sum, p) => sum + p.memberships.length * p.pricePerSeat,
            0
        );

        const pendingPayouts = await prisma.payout.count({
            where: {
                hostId: req.user.id,
                status: { in: ['PENDING', 'SCHEDULED', 'PROCESSING'] },
            },
        });

        res.json({
            success: true,
            data: { totalPools, totalMembers, monthlyRevenue, pendingPayouts },
        });
    } catch (error) {
        next(error);
    }
});

// ─── UPDATE POOL CREDENTIALS ───────────────────────────────────────────────

router.patch(
    '/:id/credentials',
    authMiddleware,
    validate({ params: idParamSchema, body: updateCredentialsSchema }),
    async (req: AuthenticatedRequest, res, next) => {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, message: 'Unauthorized' });
                return;
            }

            const pool = await prisma.pool.findUnique({
                where: { id: req.params.id },
            });

            if (!pool) {
                res.status(404).json({ success: false, message: 'Pool not found' });
                return;
            }

            if (pool.hostId !== req.user.id) {
                res.status(403).json({ success: false, message: 'You are not the host of this pool' });
                return;
            }

            // Anti-spam rate limit: prevent rapid consecutive credential updates (15 min cooldown per pool)
            const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
            const recentUpdate = await prisma.notification.findFirst({
                where: {
                    type: 'CREDENTIALS_UPDATED',
                    createdAt: { gte: fifteenMinutesAgo },
                    data: {
                        path: ['poolId'],
                        equals: pool.id,
                    },
                },
                orderBy: { createdAt: 'desc' },
            });

            if (recentUpdate) {
                const minutesLeft = Math.ceil(
                    (recentUpdate.createdAt.getTime() + 15 * 60 * 1000 - Date.now()) / (60 * 1000)
                );
                res.status(429).json({
                    success: false,
                    message: `Credentials for this pool were updated recently. Please wait ${minutesLeft} minute(s) before rotating credentials again to protect member inboxes.`,
                });
                return;
            }

            const { encryptedCredentials, encryptionPassword } = req.body;

            // Update the pool's encrypted credentials
            await prisma.pool.update({
                where: { id: pool.id },
                data: { encryptedCredentials },
            });

            // Notify all active members
            const activeMembers = await prisma.membership.findMany({
                where: {
                    poolId: pool.id,
                    status: { in: ['ACTIVE', 'IN_ESCROW'] },
                },
                include: {
                    user: { select: { id: true, email: true, fullName: true } },
                },
            });

            // Always record an update event for the host (ensures anti-spam cooldown applies even with 0 members)
            await createNotification({
                userId: pool.hostId,
                type: 'CREDENTIALS_UPDATED',
                title: 'Credentials updated',
                message: `You updated credentials for "${pool.name}".`,
                data: { poolId: pool.id },
            });

            for (const m of activeMembers) {
                // Create in-app notification with per-user limit enforcement
                await createNotification({
                    userId: m.user.id,
                    type: 'CREDENTIALS_UPDATED',
                    title: 'Credentials updated',
                    message: `The host has updated credentials for "${pool.name}". Please decrypt with the new phrase key to see the updated login.`,
                    data: { poolId: pool.id, membershipId: m.id },
                });

                // If the host provided the phrase key, email it to each active member
                if (encryptionPassword) {
                    try {
                        await sendCredentialsRotatedEmail(
                            m.user.email,
                            m.user.fullName,
                            pool.name,
                            encryptionPassword
                        );
                    } catch (emailErr: any) {
                        console.error(`[Credentials] Failed to email ${m.user.email}:`, emailErr.message);
                    }
                }
            }

            res.json({
                success: true,
                message: `Credentials updated. ${activeMembers.length} active member(s) notified.`,
            });
        } catch (error) {
            next(error);
        }
    }
);

export default router;