import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  idParamSchema,
  adminMessageSchema,
  adminNotesSchema,
  resolveDisputeSchema,
} from '../validation/index.js';
import { refundTransaction } from '../utils/paystack.js';
import { sendDisputeResolvedEmail } from '../utils/email.js';
import { recalculateHostReputation } from '../utils/reputation.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

async function countValidSeats(poolId: string): Promise<number> {
  return prisma.membership.count({
    where: {
      poolId,
      status: { in: ['ACTIVE', 'IN_ESCROW', 'DISPUTED'] },
    },
  });
}

// ─── LIST OPEN DISPUTES ────────────────────────────────────────────────────

router.get('/disputes', authMiddleware, roleMiddleware('ADMIN'), async (_req, res, next) => {
  try {
    const disputes = await prisma.dispute.findMany({
      where: { status: 'OPEN' },
      include: {
        membership: {
          include: {
            pool: {
              include: {
                host: { select: { id: true, fullName: true, email: true, reputationScore: true } },
              },
            },
            user: { select: { id: true, fullName: true, email: true, createdAt: true } },
          },
        },
        member: { select: { id: true, fullName: true, email: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const hostIds = [...new Set(disputes.map(d => d.membership.pool.host.id))];
    const hostStats = await prisma.pool.groupBy({
      by: ['hostId'],
      where: { hostId: { in: hostIds } },
      _count: { id: true },
    });

    const memberIds = [...new Set(disputes.map(d => d.memberId))];
    const memberSubCounts = await prisma.membership.groupBy({
      by: ['userId'],
      where: { userId: { in: memberIds } },
      _count: { id: true },
    });

    const memberDisputeCounts = await prisma.dispute.groupBy({
      by: ['memberId'],
      where: { memberId: { in: memberIds } },
      _count: { id: true },
    });

    const formatted = disputes.map((d) => {
      const hostPoolCount = hostStats.find(h => h.hostId === d.membership.pool.host.id)?._count.id || 0;
      const memberSubCount = memberSubCounts.find(m => m.userId === d.memberId)?._count.id || 0;
      const memberDisputeCount = memberDisputeCounts.find(m => m.memberId === d.memberId)?._count.id || 0;

      return {
        id: d.id,
        membershipId: d.membershipId,
        memberId: d.memberId,
        memberName: d.member.fullName,
        memberEmail: d.member.email,
        memberJoinedAt: d.membership.user.createdAt.toISOString(),
        memberTotalSubs: memberSubCount,
        memberTotalDisputes: memberDisputeCount,
        poolName: d.membership.pool.name,
        poolHostId: d.membership.pool.host.id,
        poolHostName: d.membership.pool.host.fullName,
        poolHostEmail: d.membership.pool.host.email,
        poolHostReputation: d.membership.pool.host.reputationScore,
        poolHostPools: hostPoolCount,
        pricePerSeat: d.membership.pool.pricePerSeat,
        reason: d.reason,
        status: d.status,
        adminNotes: d.adminNotes,
        createdAt: d.createdAt.toISOString(),
        messageCount: d._count.messages,
      };
    });

    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
});

// ─── DISPUTE TIMELINE ──────────────────────────────────────────────────────

router.get('/disputes/:id/timeline', authMiddleware, roleMiddleware('ADMIN'), async (req, res, next) => {
  try {
    const dispute = await prisma.dispute.findUnique({
      where: { id: req.params.id },
      include: {
        membership: {
          include: {
            pool: true,
            user: { select: { fullName: true } },
          },
        },
      },
    });

    if (!dispute) {
      res.status(404).json({ success: false, message: 'Dispute not found' });
      return;
    }

    const transaction = await prisma.transaction.findFirst({
      where: { membershipId: dispute.membershipId, status: 'SUCCESS' },
    });

    const payout = transaction ? await prisma.payout.findUnique({
      where: { transactionId: transaction.id },
    }) : null;

    const events = [
      {
        time: dispute.membership.pool.createdAt.toISOString(),
        actor: 'Host',
        action: `Created pool "${dispute.membership.pool.name}"`,
        type: 'info',
      },
      {
        time: dispute.membership.createdAt.toISOString(),
        actor: 'System',
        action: `${dispute.membership.user.fullName} joined the pool`,
        type: 'info',
      },
    ];

    if (transaction) {
      events.push({
        time: transaction.createdAt.toISOString(),
        actor: 'Paystack',
        action: `Payment confirmed — ₦${transaction.amount.toLocaleString()} (Ref: ${transaction.reference})`,
        type: 'success',
      });
    }

    events.push({
      time: dispute.createdAt.toISOString(),
      actor: 'Member',
      action: `Raised dispute: "${dispute.reason}"`,
      type: 'warning',
    });

    if (payout) {
      events.push({
        time: payout.createdAt.toISOString(),
        actor: 'System',
        action: `Host payout of ₦${payout.amount.toLocaleString()} queued`,
        type: 'info',
      });
    }

    events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    res.json({
      success: true,
      data: {
        events,
        transaction: transaction ? {
          reference: transaction.reference,
          amount: transaction.amount,
          platformFee: transaction.platformFee,
          hostPayout: transaction.hostPayout,
          status: transaction.status,
          createdAt: transaction.createdAt.toISOString(),
        } : null,
        payout: payout ? {
          status: payout.status,
          amount: payout.amount,
          failureReason: payout.failureReason,
        } : null,
        escrowEndsAt: dispute.membership.escrowEndsAt?.toISOString() || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── DISPUTE MESSAGES ──────────────────────────────────────────────────────

router.get('/disputes/:id/messages', authMiddleware, roleMiddleware('ADMIN'), async (req, res, next) => {
  try {
    const messages = await prisma.disputeMessage.findMany({
      where: { disputeId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: messages });
  } catch (error) {
    next(error);
  }
});

// ─── DISPUTE EVIDENCE ─────────────────────────────────────────────────────

router.get('/disputes/:id/evidence', authMiddleware, roleMiddleware('ADMIN'), async (req, res, next) => {
  try {
    const evidences = await prisma.disputeEvidence.findMany({
      where: { disputeId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: evidences });
  } catch (error) {
    next(error);
  }
});

// ─── ADMIN POST MESSAGE ────────────────────────────────────────────────────

router.post(
  '/disputes/:id/messages',
  authMiddleware,
  roleMiddleware('ADMIN'),
  validate({ params: idParamSchema, body: adminMessageSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { message } = req.body;

      const msg = await prisma.disputeMessage.create({
        data: {
          disputeId: req.params.id,
          senderId: req.user!.id,
          senderRole: 'ADMIN',
          message: message.trim(),
        },
      });

      res.json({ success: true, data: msg });
    } catch (error) {
      next(error);
    }
  }
);

// ─── ADMIN SAVE NOTES ──────────────────────────────────────────────────────

router.post(
  '/disputes/:id/notes',
  authMiddleware,
  roleMiddleware('ADMIN'),
  validate({ params: idParamSchema, body: adminNotesSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { notes } = req.body;
      await prisma.dispute.update({
        where: { id: req.params.id },
        data: { adminNotes: notes },
      });
      res.json({ success: true, message: 'Notes saved' });
    } catch (error) {
      next(error);
    }
  }
);

// ─── RESOLVE DISPUTE ───────────────────────────────────────────────────────

router.post(
  '/disputes/:id/resolve',
  authMiddleware,
  roleMiddleware('ADMIN'),
  validate({ params: idParamSchema, body: resolveDisputeSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { action, adminNotes } = req.body;
      const adminId = req.user!.id;

      const dispute = await prisma.dispute.findUnique({
        where: { id: req.params.id },
        include: {
          membership: {
            include: {
              pool: true,
              user: { select: { email: true, fullName: true, id: true } },
            },
          },
        },
      });

      if (!dispute || dispute.status !== 'OPEN') {
        res.status(404).json({ success: false, message: 'Dispute not found or already resolved' });
        return;
      }

      const membership = dispute.membership;
      const transaction = await prisma.transaction.findFirst({
        where: { membershipId: membership.id, status: 'SUCCESS' },
      });

      // ─── REFUND PATH ─────────────────────────────────────────────────────

      if (action === 'REFUND') {
        // 1. Call Paystack FIRST — if this fails, don't touch the database
        if (transaction) {
          try {
            await refundTransaction(transaction.reference);
          } catch (err: any) {
            console.error('Paystack refund failed:', err.message);
            res.status(502).json({
              success: false,
              message: `Paystack refund failed: ${err.message}. No database changes were made. Please retry or handle manually.`,
            });
            return;
          }
        }

        // 2. Atomic database updates
        await prisma.$transaction(async (tx) => {
          // Resolve dispute
          await tx.dispute.update({
            where: { id: dispute.id },
            data: {
              status: 'RESOLVED',
              resolution: 'REFUND',
              resolvedBy: adminId,
              resolvedAt: new Date(),
              ...(adminNotes !== undefined ? { adminNotes } : {}),
            },
          });

          // Cancel membership
          await tx.membership.update({
            where: { id: membership.id },
            data: { status: 'CANCELLED' },
          });

          // Mark transaction refunded
          if (transaction) {
            await tx.transaction.update({
              where: { id: transaction.id },
              data: { status: 'REFUNDED' },
            });

            // Cancel payout
            const payout = await tx.payout.findUnique({
              where: { transactionId: transaction.id },
            });
            if (payout) {
              await tx.payout.update({
                where: { id: payout.id },
                data: {
                  status: 'FAILED',
                  failureReason: 'Dispute resolved — member refunded',
                },
              });
            }
          }

          // Reopen pool if it was full
          const pool = await tx.pool.findUnique({
            where: { id: membership.poolId },
          });
          if (pool && pool.status === 'FULL') {
            const validSeats = await tx.membership.count({
              where: {
                poolId: pool.id,
                status: { in: ['ACTIVE', 'IN_ESCROW', 'DISPUTED'] },
              },
            });
            if (validSeats < pool.totalSeats) {
              await tx.pool.update({
                where: { id: pool.id },
                data: { status: 'ACTIVE' },
              });
            }
          }
        });

        // 3. Side effects (outside transaction so emails don't roll back DB)
        await recalculateHostReputation(membership.pool.hostId);

        const host = await prisma.user.findUnique({
          where: { id: membership.pool.hostId },
          select: { email: true, fullName: true },
        });

        if (host) {
          await sendDisputeResolvedEmail(host.email, host.fullName, membership.pool.name, action, true);
        }
        await sendDisputeResolvedEmail(membership.user.email, membership.user.fullName, membership.pool.name, action, true);

        await prisma.notification.create({
          data: {
            userId: membership.userId,
            type: 'DISPUTE_RESOLVED',
            title: 'Dispute resolved',
            message: `Your dispute for "${membership.pool.name}" was resolved: You have been refunded.`,
            data: { disputeId: dispute.id, poolId: membership.poolId },
          },
        });

        if (host) {
          await prisma.notification.create({
            data: {
              userId: membership.pool.hostId,
              type: 'DISPUTE_RESOLVED',
              title: 'Dispute resolved',
              message: `The dispute on "${membership.pool.name}" was resolved in favor of the member.`,
              data: { disputeId: dispute.id, poolId: membership.poolId },
            },
          });
        }

        res.json({
          success: true,
          message: 'Member refunded. Pool seat reopened.',
        });
        return;
      }

      // ─── CONFIRM ACCESS PATH ─────────────────────────────────────────────

      if (action === 'CONFIRM_ACCESS') {
        // 1. Atomic database updates
        await prisma.$transaction(async (tx) => {
          await tx.dispute.update({
            where: { id: dispute.id },
            data: {
              status: 'RESOLVED',
              resolution: 'CONFIRM_ACCESS',
              resolvedBy: adminId,
              resolvedAt: new Date(),
              ...(adminNotes !== undefined ? { adminNotes } : {}),
            },
          });

          await tx.membership.update({
            where: { id: membership.id },
            data: { status: 'ACTIVE' },
          });

          // Schedule payout (don't transfer immediately — let cron handle it)
          if (transaction) {
            const payout = await tx.payout.findUnique({
              where: { transactionId: transaction.id },
            });

            if (payout && (payout.status === 'PENDING' || payout.status === 'FAILED')) {
              await tx.payout.update({
                where: { id: payout.id },
                data: {
                  status: 'SCHEDULED',
                  payoutDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
                },
              });
            }
          }
        });

        // 2. Side effects
        await recalculateHostReputation(membership.pool.hostId);

        const host = await prisma.user.findUnique({
          where: { id: membership.pool.hostId },
          select: { email: true, fullName: true },
        });

        if (host) {
          await sendDisputeResolvedEmail(host.email, host.fullName, membership.pool.name, action, false);
        }
        await sendDisputeResolvedEmail(membership.user.email, membership.user.fullName, membership.pool.name, action, false);

        await prisma.notification.create({
          data: {
            userId: membership.userId,
            type: 'DISPUTE_RESOLVED',
            title: 'Dispute resolved',
            message: `Your dispute for "${membership.pool.name}" was resolved: Access confirmed.`,
            data: { disputeId: dispute.id, poolId: membership.poolId },
          },
        });

        if (host) {
          await prisma.notification.create({
            data: {
              userId: membership.pool.hostId,
              type: 'DISPUTE_RESOLVED',
              title: 'Dispute resolved',
              message: `The dispute on "${membership.pool.name}" was resolved in your favor. Payout scheduled.`,
              data: { disputeId: dispute.id, poolId: membership.poolId },
            },
          });
        }

        res.json({
          success: true,
          message: 'Access confirmed. Host payout scheduled for 48 hours.',
        });
        return;
      }

      // Fallback
      res.status(400).json({ success: false, message: 'Invalid action' });
    } catch (error) {
      next(error);
    }
  }
);

export default router;