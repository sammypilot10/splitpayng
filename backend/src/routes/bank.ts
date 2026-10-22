import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { resolveBankSchema, setupBankSchema } from '../validation/index.js';
import { resolveBankAccount, createTransferRecipient } from '../utils/paystack.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import type { ApiResponse } from '../types.js';

const router = Router();

router.get('/list', async (_req, res, next) => {
  try {
    const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
    const response = await fetch('https://api.paystack.co/bank?country=nigeria', {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
    });
    const data = await response.json();

    if (!data.status) {
      res.status(500).json({ success: false, message: 'Failed to fetch banks' });
      return;
    }

    const banks = data.data.map((b: any) => ({
      code: b.code,
      name: b.name,
      slug: b.slug,
    }));

    res.json({ success: true, data: banks });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/resolve',
  authMiddleware,
  validate({ body: resolveBankSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { bankCode, accountNumber } = req.body;

      const resolved = await resolveBankAccount(accountNumber, bankCode);
      res.json({ success: true, data: { accountName: resolved.account_name } });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to resolve account' });
    }
  }
);

router.post(
  '/setup',
  authMiddleware,
  validate({ body: setupBankSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { bankCode, bankName, accountNumber, accountName } = req.body;

      const recipient = await createTransferRecipient(accountName, accountNumber, bankCode);

      const bankAccount = await prisma.bankAccount.upsert({
        where: { userId: req.user.id },
        update: {
          bankCode,
          bankName,
          accountNumber,
          accountName,
          recipientCode: recipient.recipient_code,
          verified: true,
        },
        create: {
          userId: req.user.id,
          bankCode,
          bankName,
          accountNumber,
          accountName,
          recipientCode: recipient.recipient_code,
          verified: true,
        },
      });

      // Automatically reschedule any payouts that previously failed due to missing bank account
      await prisma.payout.updateMany({
        where: {
          hostId: req.user.id,
          status: 'FAILED',
          failureReason: 'No verified bank account',
        },
        data: {
          status: 'SCHEDULED',
          payoutDueAt: new Date(),
          failureReason: null,
        },
      });

      res.json({
        success: true,
        message: 'Bank account verified and saved',
        data: {
          id: bankAccount.id,
          bankName: bankAccount.bankName,
          accountNumber: bankAccount.accountNumber,
          accountName: bankAccount.accountName,
          verified: bankAccount.verified,
        },
      });
    } catch (error: any) {
      res.status(400).json({ success: false, message: error.message || 'Failed to save bank account' });
    }
  }
);

router.get('/my', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const account = await prisma.bankAccount.findUnique({
      where: { userId: req.user.id },
    });

    if (!account) {
      res.json({ success: true, data: null });
      return;
    }

    res.json({
      success: true,
      data: {
        id: account.id,
        bankName: account.bankName,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        verified: account.verified,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/payouts', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const payouts = await prisma.payout.findMany({
      where: { hostId: req.user.id },
      include: {
        transaction: {
          include: {
            membership: {
              include: {
                pool: { select: { id: true, name: true, category: true } },
                user: { select: { id: true, fullName: true, email: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = payouts.map((p) => ({
      id: p.id,
      amount: p.amount,
      status: p.status,
      transferCode: p.transferCode,
      failureReason: p.failureReason,
      payoutDueAt: p.payoutDueAt?.toISOString() || null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      poolName: p.transaction?.membership?.pool?.name || 'Pool Subscription',
      memberName: p.transaction?.membership?.user?.fullName || 'Pool Member',
      reference: p.transaction?.reference || '',
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
});

export default router;