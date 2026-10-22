import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { upload, validateFileType } from '../middleware/upload.js';
import { validate } from '../middleware/validate.js';
import {
  idParamSchema,
  decryptCredentialsSchema,
  sharePasswordSchema,
  disputeSchema,
  disputeMessageSchema,
} from '../validation/index.js';
import { initiateTransfer } from '../utils/paystack.js';
import { decrypt } from '../utils/encryption.js';
import { sendCredentialsEmail, sendDisputeOpenedEmail } from '../utils/email.js';
import { recalculateHostReputation } from '../utils/reputation.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

async function countValidSeats(poolId: string) {
  return prisma.membership.count({
    where: {
      poolId,
      status: { in: ['ACTIVE', 'IN_ESCROW', 'DISPUTED'] },
    },
  });
}

router.get('/my', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const memberships = await prisma.membership.findMany({
      where: { userId: req.user.id },
      include: {
        pool: {
          include: {
            host: { select: { fullName: true, reputationScore: true, totalDisputes: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      poolId: m.poolId,
      status: m.status,
      escrowEndsAt: m.escrowEndsAt?.toISOString() || null,
      nextBillingDate: m.nextBillingDate?.toISOString() || null,
      paystackAuthCode: m.paystackAuthCode,
      createdAt: m.createdAt.toISOString(),
      pool: {
        id: m.pool.id,
        hostId: m.pool.hostId,
        name: m.pool.name,
        category: m.pool.category,
        poolType: m.pool.poolType,
        totalSeats: m.pool.totalSeats,
        pricePerSeat: m.pool.pricePerSeat,
        renewalDay: m.pool.renewalDay,
        encryptedCredentials: m.pool.encryptedCredentials,
        status: m.pool.status,
        createdAt: m.pool.createdAt.toISOString(),
        host: m.pool.host,
      },
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
});

router.get('/host', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const pools = await prisma.pool.findMany({
      where: { hostId: req.user.id },
      include: {
        memberships: {
          include: {
            user: { select: { id: true, fullName: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = pools.map((pool) => {
      const validMemberships = pool.memberships.filter((m) =>
        ['ACTIVE', 'IN_ESCROW', 'DISPUTED'].includes(m.status)
      );

      return {
        id: pool.id,
        name: pool.name,
        category: pool.category,
        poolType: pool.poolType,
        totalSeats: pool.totalSeats,
        pricePerSeat: pool.pricePerSeat,
        status: pool.status,
        createdAt: pool.createdAt.toISOString(),
        seatsTaken: validMemberships.length,
        seatsAvailable: pool.totalSeats - validMemberships.length,
        memberships: pool.memberships.map((m) => ({
          id: m.id,
          userId: m.userId,
          status: m.status,
          escrowEndsAt: m.escrowEndsAt?.toISOString() || null,
          nextBillingDate: m.nextBillingDate?.toISOString() || null,
          createdAt: m.createdAt.toISOString(),
          user: m.user,
        })),
      };
    });

    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/:id/decrypt',
  authMiddleware,
  validate({ params: idParamSchema, body: decryptCredentialsSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { encryptionPassword } = req.body;

      const membership = await prisma.membership.findUnique({
        where: { id: req.params.id },
        include: { pool: true },
      });

      if (!membership || membership.userId !== req.user.id) {
        res.status(404).json({ success: false, message: 'Membership not found' });
        return;
      }

      if (membership.status === 'CANCELLED' || membership.status === 'FAILED') {
        res.status(403).json({ success: false, message: 'Subscription is not active' });
        return;
      }

      const decrypted = decrypt(membership.pool.encryptedCredentials, encryptionPassword);
      const credentials = JSON.parse(decrypted);

      res.json({ success: true, data: credentials });
    } catch (error) {
      res.status(400).json({ success: false, message: 'Invalid encryption password or corrupted credentials' });
    }
  }
);

router.post(
  '/:id/share-password',
  authMiddleware,
  validate({ params: idParamSchema, body: sharePasswordSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { encryptionPassword } = req.body;

      const membership = await prisma.membership.findUnique({
        where: { id: req.params.id },
        include: {
          pool: true,
          user: { select: { email: true, fullName: true } },
        },
      });

      if (!membership) {
        res.status(404).json({ success: false, message: 'Membership not found' });
        return;
      }

      if (membership.pool.hostId !== req.user.id) {
        res.status(403).json({ success: false, message: 'You are not the host of this pool' });
        return;
      }

      try {
        decrypt(membership.pool.encryptedCredentials, encryptionPassword);
      } catch {
        res.status(400).json({ success: false, message: 'Invalid encryption password' });
        return;
      }

      await sendCredentialsEmail(
        membership.user.email,
        membership.user.fullName,
        membership.pool.name,
        encryptionPassword
      );

      res.json({ success: true, message: `Password sent to ${membership.user.email}` });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/:id/confirm', authMiddleware, validate({ params: idParamSchema }), async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const membership = await prisma.membership.findUnique({
      where: { id: req.params.id },
      include: { pool: true },
    });

    if (!membership || membership.userId !== req.user.id) {
      res.status(404).json({ success: false, message: 'Membership not found' });
      return;
    }

    if (membership.status !== 'IN_ESCROW') {
      res.status(400).json({ success: false, message: 'Membership is not in escrow' });
      return;
    }

    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'ACTIVE' },
    });

    // Member explicitly verified and confirmed access; release host payout immediately
    const payoutDueAt = new Date();

    const transaction = await prisma.transaction.findFirst({
      where: { membershipId: membership.id, status: 'SUCCESS' },
      include: { payout: true },
    });

    if (transaction && transaction.payout) {
      await prisma.payout.update({
        where: { id: transaction.payout.id },
        data: {
          status: 'SCHEDULED',
          payoutDueAt,
        },
      });
    }

    res.json({
      success: true,
      message: 'Access confirmed. Host payout has been scheduled for immediate transfer.',
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/:id/dispute',
  authMiddleware,
  validate({ params: idParamSchema, body: disputeSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { reason } = req.body;

      const membership = await prisma.membership.findUnique({
        where: { id: req.params.id },
        include: { pool: { include: { host: true } } },
      });

      if (!membership || membership.userId !== req.user.id) {
        res.status(404).json({ success: false, message: 'Membership not found' });
        return;
      }

      if (membership.status !== 'IN_ESCROW') {
        res.status(400).json({ success: false, message: 'Can only dispute during escrow period' });
        return;
      }

      const existingDispute = await prisma.dispute.findFirst({
        where: {
          membershipId: membership.id,
          status: 'OPEN',
        },
      });
      if (existingDispute) {
        res.status(400).json({ success: false, message: 'A dispute is already open for this subscription' });
        return;
      }

      await prisma.$transaction(async (tx) => {
        await tx.membership.update({
          where: { id: membership.id },
          data: { status: 'DISPUTED' },
        });

        await tx.dispute.create({
          data: {
            membershipId: membership.id,
            memberId: req.user!.id,
            reason,
            status: 'OPEN',
          },
        });
      });

      await recalculateHostReputation(membership.pool.hostId);

      await sendDisputeOpenedEmail(
        membership.pool.host.email,
        membership.pool.host.fullName,
        membership.pool.name,
        reason,
        true
      );

      await prisma.notification.create({
        data: {
          userId: membership.pool.hostId,
          type: 'DISPUTE_OPENED',
          title: 'Dispute opened',
          message: `A dispute was opened on "${membership.pool.name}". Reason: ${reason}`,
          data: { poolId: membership.poolId, membershipId: membership.id },
        },
      });

      res.json({ success: true, message: 'Dispute raised. Admin will review shortly.' });
    } catch (error) {
      next(error);
    }
  }
);

router.post('/:id/report-broken', authMiddleware, validate({ params: idParamSchema }), async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const membership = await prisma.membership.findUnique({
      where: { id: req.params.id },
      include: { pool: { include: { host: true } } },
    });

    if (!membership || membership.userId !== req.user.id) {
      res.status(404).json({ success: false, message: 'Membership not found' });
      return;
    }

    if (membership.status !== 'ACTIVE') {
      res.status(400).json({ success: false, message: 'Only active subscriptions can be reported' });
      return;
    }

    const daysSinceJoin = (Date.now() - membership.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceJoin > 7) {
      res.status(400).json({ success: false, message: 'Report window expired (7 days)' });
      return;
    }

    const existingDispute = await prisma.dispute.findFirst({
      where: {
        membershipId: membership.id,
        status: 'OPEN',
      },
    });
    if (existingDispute) {
      res.status(400).json({ success: false, message: 'A dispute is already open for this subscription' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.update({
        where: { id: membership.id },
        data: { status: 'DISPUTED' },
      });

      await tx.dispute.create({
        data: {
          membershipId: membership.id,
          memberId: req.user!.id,
          reason: 'Credentials stopped working after confirmation',
          status: 'OPEN',
        },
      });
    });

    await recalculateHostReputation(membership.pool.hostId);

    await sendDisputeOpenedEmail(
      membership.pool.host.email,
      membership.pool.host.fullName,
      membership.pool.name,
      'Credentials stopped working after confirmation',
      true
    );

    await prisma.notification.create({
      data: {
        userId: membership.pool.hostId,
        type: 'DISPUTE_OPENED',
        title: 'Dispute opened',
        message: `A member reported broken credentials for "${membership.pool.name}".`,
        data: { poolId: membership.poolId, membershipId: membership.id },
      },
    });

    const transaction = await prisma.transaction.findFirst({
      where: { membershipId: membership.id },
      include: { payout: true },
    });

    if (transaction?.payout?.status === 'PROCESSING') {
      console.warn(`URGENT: Payout for ${membership.id} already sent. Manual reversal needed.`);
    }

    res.json({ success: true, message: 'Reported. Admin will review within 24 hours.' });
  } catch (error) {
    next(error);
  }
});

// ─── GET DISPUTE MESSAGES ──────────────────────────────────────────────────

router.get('/:id/dispute/messages', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const membership = await prisma.membership.findUnique({
      where: { id: req.params.id },
      include: { pool: true, disputes: true },
    });

    if (!membership) {
      res.status(404).json({ success: false, message: 'Membership not found' });
      return;
    }

    const isAuthorized =
      membership.userId === req.user.id ||
      membership.pool.hostId === req.user.id ||
      req.user.role === 'ADMIN';

    if (!isAuthorized) {
      res.status(403).json({ success: false, message: 'Not authorized' });
      return;
    }

    const dispute = membership.disputes.find((d) => d.status === 'OPEN');
    if (!dispute) {
      res.status(404).json({ success: false, message: 'No active dispute' });
      return;
    }

    const messages = await prisma.disputeMessage.findMany({
      where: { disputeId: dispute.id },
      orderBy: { createdAt: 'asc' },
    });

    const correctedMessages = messages.map((msg) => {
      let senderRole = msg.senderRole;
      if (msg.senderId === membership.userId) senderRole = 'MEMBER';
      else if (msg.senderId === membership.pool.hostId) senderRole = 'HOST';
      return { ...msg, senderRole };
    });

    res.json({ success: true, data: correctedMessages, disputeId: dispute.id });
  } catch (error) {
    next(error);
  }
});

// ─── POST DISPUTE MESSAGE (NEW — was missing!) ─────────────────────────────

router.post(
  '/:id/dispute/messages',
  authMiddleware,
  validate({ params: idParamSchema, body: disputeMessageSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { message } = req.body;

      const membership = await prisma.membership.findUnique({
        where: { id: req.params.id },
        include: { pool: true, disputes: true },
      });

      if (!membership) {
        res.status(404).json({ success: false, message: 'Membership not found' });
        return;
      }

      let senderRole: string;
      if (req.user.role === 'ADMIN') senderRole = 'ADMIN';
      else if (membership.userId === req.user.id) senderRole = 'MEMBER';
      else if (membership.pool.hostId === req.user.id) senderRole = 'HOST';
      else {
        res.status(403).json({ success: false, message: 'Not authorized' });
        return;
      }

      const dispute = membership.disputes.find((d) => d.status === 'OPEN');
      if (!dispute) {
        res.status(404).json({ success: false, message: 'No active dispute' });
        return;
      }

      const msg = await prisma.disputeMessage.create({
        data: {
          disputeId: dispute.id,
          senderId: req.user.id,
          senderRole,
          message: message.trim(),
        },
      });

      res.json({ success: true, data: msg });
    } catch (error) {
      next(error);
    }
  }
);

// ─── POST DISPUTE EVIDENCE (FIXED — was creating DisputeMessage instead!) ──

router.post(
  '/:id/dispute/evidence',
  authMiddleware,
  upload.single('evidence'),
  validateFileType,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ success: false, message: 'No file uploaded' });
        return;
      }

      const membership = await prisma.membership.findUnique({
        where: { id: req.params.id },
        include: { pool: true, disputes: true },
      });

      if (!membership) {
        res.status(404).json({ success: false, message: 'Membership not found' });
        return;
      }

      let role: string;
      if (req.user.role === 'ADMIN') role = 'ADMIN';
      else if (membership.userId === req.user.id) role = 'MEMBER';
      else if (membership.pool.hostId === req.user.id) role = 'HOST';
      else {
        res.status(403).json({ success: false, message: 'Not authorized' });
        return;
      }

      const dispute = membership.disputes.find((d) => d.status === 'OPEN');
      if (!dispute) {
        res.status(404).json({ success: false, message: 'No active dispute' });
        return;
      }

      const fileUrl = `/uploads/${req.file.filename}`;

      const evidence = await prisma.disputeEvidence.create({
        data: {
          disputeId: dispute.id,
          uploadedBy: req.user.id,
          role,
          fileUrl,
          fileName: req.file.originalname,
        },
      });

      res.json({ success: true, data: evidence });
    } catch (error) {
      next(error);
    }
  }
);

// ─── GET DISPUTE EVIDENCE ──────────────────────────────────────────────────

router.get('/:id/dispute/evidence', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const membership = await prisma.membership.findUnique({
      where: { id: req.params.id },
      include: { pool: true, disputes: true },
    });

    if (!membership) {
      res.status(404).json({ success: false, message: 'Membership not found' });
      return;
    }

    const isAuthorized =
      membership.userId === req.user.id ||
      membership.pool.hostId === req.user.id ||
      req.user.role === 'ADMIN';

    if (!isAuthorized) {
      res.status(403).json({ success: false, message: 'Not authorized' });
      return;
    }

    const dispute = membership.disputes.find((d) => d.status === 'OPEN');
    if (!dispute) {
      res.status(404).json({ success: false, message: 'No active dispute' });
      return;
    }

    const evidences = await prisma.disputeEvidence.findMany({
      where: { disputeId: dispute.id },
      orderBy: { createdAt: 'asc' },
    });

    const correctedEvidences = evidences.map((ev) => {
      let role = ev.role;
      if (ev.uploadedBy === membership.userId) role = 'MEMBER';
      else if (ev.uploadedBy === membership.pool.hostId) role = 'HOST';
      return { ...ev, role };
    });

    res.json({ success: true, data: correctedEvidences });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/cancel', authMiddleware, validate({ params: idParamSchema }), async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const membership = await prisma.membership.findUnique({
      where: { id: req.params.id },
    });

    if (!membership || membership.userId !== req.user.id) {
      res.status(404).json({ success: false, message: 'Membership not found' });
      return;
    }

    await prisma.membership.update({
      where: { id: membership.id },
      data: { status: 'CANCELLED' },
    });

    const pool = await prisma.pool.findUnique({ where: { id: membership.poolId } });
    if (pool && pool.status === 'FULL') {
      const validCount = await countValidSeats(pool.id);
      if (validCount < pool.totalSeats) {
        await prisma.pool.update({ where: { id: pool.id }, data: { status: 'ACTIVE' } });
      }
    }

    res.json({ success: true, message: 'Subscription cancelled' });
  } catch (error) {
    next(error);
  }
});

export default router;