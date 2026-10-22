import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

// ─── GET MY DISPUTES (Member or Host) ──────────────────────────────────────

router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const disputes = await prisma.dispute.findMany({
      where: {
        OR: [
          { memberId: req.user.id },
          { membership: { pool: { hostId: req.user.id } } },
        ],
      },
      include: {
        membership: {
          include: {
            pool: { select: { name: true, hostId: true, pricePerSeat: true } },
            user: { select: { fullName: true, email: true } },
          },
        },
        member: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = disputes.map((d) => ({
      id: d.id,
      membershipId: d.membershipId,
      memberId: d.memberId,
      memberName: d.member.fullName,
      memberEmail: d.member.email,
      poolName: d.membership.pool.name,
      reason: d.reason,
      status: d.status,
      resolution: d.resolution,
      resolvedBy: d.resolvedBy,
      resolvedAt: d.resolvedAt?.toISOString() || null,
      createdAt: d.createdAt.toISOString(),
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
});

export default router;