import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { initializePaymentSchema, verifyPaymentQuerySchema } from '../validation/index.js';
import { initializeTransaction, verifyTransaction, chargeAuthorization, refundTransaction } from '../utils/paystack.js';
import { recalculateHostReputation } from '../utils/reputation.js';
import { sendPaymentSuccessEmail, sendPoolFilledEmail, sendNewMemberEmail } from '../utils/email.js';
import { createNotification } from '../utils/notifications.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();
const PLATFORM_FEE_PERCENT = 0.20;

async function countValidSeats(poolId: string): Promise<number> {
  return prisma.membership.count({
    where: {
      poolId,
      status: { in: ['ACTIVE', 'IN_ESCROW', 'DISPUTED'] },
    },
  });
}

// ─── INITIALIZE PAYMENT ────────────────────────────────────────────────────

router.post(
  '/initialize',
  authMiddleware,
  validate({ body: initializePaymentSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return;
      }

      const { poolId, paymentMethodId, useSavedCard } = req.body;

      const pool = await prisma.pool.findUnique({
        where: { id: poolId },
      });

      if (!pool) {
        res.status(404).json({ success: false, message: 'Pool not found' });
        return;
      }

      const validSeats = await countValidSeats(poolId);
      if (validSeats >= pool.totalSeats || pool.status === 'FULL') {
        res.status(400).json({ success: false, message: 'Pool is full' });
        return;
      }

      // Block if already active/escrow/disputed
      const existing = await prisma.membership.findUnique({
        where: { userId_poolId: { userId: req.user.id, poolId } },
      });

      if (existing && !['CANCELLED', 'FAILED'].includes(existing.status)) {
        res.status(409).json({ success: false, message: 'Already joined this pool' });
        return;
      }

      const reference = `SP-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const amount = pool.pricePerSeat;
      const platformFee = Math.floor(amount * PLATFORM_FEE_PERCENT);
      const hostPayout = amount - platformFee;

      await prisma.transaction.create({
        data: {
          userId: req.user.id,
          reference,
          amount,
          platformFee,
          hostPayout,
          status: 'PENDING',
          type: 'JOIN',
          paystackData: { poolId, userId: req.user.id },
        },
      });

      // 1-Click Payment with Saved Card Authorization
      if (useSavedCard) {
        const pm = paymentMethodId
          ? await prisma.paymentMethod.findFirst({ where: { id: paymentMethodId, userId: req.user.id } })
          : await prisma.paymentMethod.findFirst({ where: { userId: req.user.id, isDefault: true } });

        if (!pm) {
          res.status(400).json({ success: false, message: 'Saved payment card not found' });
          return;
        }

        try {
          const chargeResult = await chargeAuthorization(
            pm.authorizationCode,
            req.user.email,
            amount,
            reference,
            { poolId, userId: req.user.id }
          );

          if (chargeResult?.status === 'success') {
            const processResult = await processPayment(reference, chargeResult);
            if (!processResult.success) {
              res.status(400).json({ success: false, message: processResult.message });
              return;
            }
            res.json({
              success: true,
              data: {
                paidWithSavedCard: true,
                reference,
                result: processResult,
              },
            });
            return;
          } else {
            res.status(400).json({
              success: false,
              message: chargeResult?.gateway_response || 'Card debit failed with saved card',
            });
            return;
          }
        } catch (chargeErr: any) {
          console.error('[Payment] 1-Click saved card debit failed:', chargeErr.message);
          res.status(400).json({
            success: false,
            message: chargeErr.message || 'Unable to debit saved card. Please use another card.',
          });
          return;
        }
      }

      // Initialize Paystack with strictly enforced 'card' channel to ensure tokenization
      const callbackUrl = `${process.env.FRONTEND_URL}/payment/callback`;
      const paystackData = await initializeTransaction(
        req.user.email,
        amount,
        callbackUrl,
        reference,
        { poolId, userId: req.user.id },
        ['card']
      );

      res.json({
        success: true,
        data: {
          authorizationUrl: paystackData.authorization_url,
          reference,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// ─── VERIFY PAYMENT (Frontend callback) ────────────────────────────────────

router.get('/verify', validate({ query: verifyPaymentQuerySchema }), async (req, res, next) => {
  try {
    const { reference } = req.query as { reference: string };
    const result = await processPayment(reference);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ─── PAYSTACK WEBHOOK ──────────────────────────────────────────────────────

router.post('/webhook', async (req, res, next) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY || '';
    const hash = req.headers['x-paystack-signature'] as string;

    // ── Enforce signature verification ──────────────────────────────────
    if (!secret) {
      console.error('[Webhook] PAYSTACK_SECRET_KEY is not configured');
      res.status(500).json({ success: false, message: 'Webhook secret not configured' });
      return;
    }
    if (!hash) {
      console.warn('[Webhook] Missing x-paystack-signature header — rejecting');
      res.status(401).json({ success: false, message: 'Missing signature' });
      return;
    }

    // Use the raw request body bytes (captured by the verify callback in
    // express.json) for deterministic HMAC computation.  Falling back to
    // JSON.stringify only if rawBody is somehow unavailable (should not
    // happen in practice).
    const crypto = await import('crypto');
    const payload = (req as any).rawBody || JSON.stringify(req.body);
    const expected = crypto.createHmac('sha512', secret).update(payload).digest('hex');
    if (expected !== hash) {
      console.warn('[Webhook] Signature mismatch — rejecting');
      res.status(401).json({ success: false, message: 'Invalid signature' });
      return;
    }

    const event = req.body;
    if (event.event === 'charge.success') {
      const reference = event.data?.reference;
      if (reference) {
        await processPayment(reference, event.data);
      }
    } else if (event.event === 'transfer.success') {
      // Paystack sends `reference` (our custom TRF-xxx) and `transfer_code` (Paystack's TRF_xxx)
      // We stored our custom ref in the `transferCode` column, so try matching both
      const transferRef = event.data?.reference;
      const paystackCode = event.data?.transfer_code;

      if (!transferRef && !paystackCode) {
        res.status(200).send('OK');
        return;
      }

      // Look up using our stored transferCode — try our ref first, then Paystack's code
      const payout = await prisma.payout.findFirst({
        where: { transferCode: transferRef || paystackCode },
        include: { host: true, transaction: { include: { membership: { include: { pool: true } } } } },
      });

      if (payout && payout.status !== 'COMPLETED') {
        await prisma.payout.update({
          where: { id: payout.id },
          data: { status: 'COMPLETED' },
        });

        const poolName = payout.transaction?.membership?.pool?.name || 'Subscription Pool';
        await createNotification({
          userId: payout.hostId,
          type: 'PAYOUT_COMPLETED',
          title: 'Payout disbursed successfully',
          message: `₦${payout.amount.toLocaleString()} has been credited to your bank account for "${poolName}".`,
          data: { payoutId: payout.id, amount: payout.amount },
        });
      }
    } else if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
      const transferRef = event.data?.reference;
      const paystackCode = event.data?.transfer_code;
      const reason = event.data?.reason || event.data?.gateway_response || 'Bank transfer failed or was reversed';

      if (!transferRef && !paystackCode) {
        res.status(200).send('OK');
        return;
      }

      const payout = await prisma.payout.findFirst({
        where: { transferCode: transferRef || paystackCode },
        include: { host: true, transaction: { include: { membership: { include: { pool: true } } } } },
      });

      if (payout) {
        await prisma.payout.update({
          where: { id: payout.id },
          data: { status: 'FAILED', failureReason: reason },
        });

        const poolName = payout.transaction?.membership?.pool?.name || 'Subscription Pool';
        await createNotification({
          userId: payout.hostId,
          type: 'PAYOUT_FAILED',
          title: 'Payout transfer failed',
          message: `Transfer of ₦${payout.amount.toLocaleString()} for "${poolName}" could not be completed: ${reason}. Please verify your bank details in Payout Setup.`,
          data: { payoutId: payout.id, amount: payout.amount, reason },
        });
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    next(error);
  }
});

// ─── PAYMENT METHODS MANAGEMENT ──────────────────────────────────────────

router.get('/methods', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const methods = await prisma.paymentMethod.findMany({
      where: { userId: req.user.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        cardType: true,
        last4: true,
        expMonth: true,
        expYear: true,
        bank: true,
        brand: true,
        isDefault: true,
        createdAt: true,
      },
    });

    res.json({ success: true, data: methods });
  } catch (error) {
    next(error);
  }
});

router.post('/methods/initialize-add', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const reference = `CARD-ADD-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const amount = 100; // ₦100 refundable card verification fee

    await prisma.transaction.create({
      data: {
        userId: req.user.id,
        reference,
        amount,
        platformFee: 0,
        hostPayout: 0,
        status: 'PENDING',
        type: 'CARD_VERIFICATION',
      },
    });

    const callbackUrl = `${process.env.FRONTEND_URL}/payment/callback?type=card_add`;
    const paystackData = await initializeTransaction(
      req.user.email,
      amount,
      callbackUrl,
      reference,
      { type: 'CARD_VERIFICATION', userId: req.user.id },
      ['card']
    );

    res.json({
      success: true,
      data: {
        authorizationUrl: paystackData.authorization_url,
        reference,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/methods/:id/default', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const method = await prisma.paymentMethod.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!method) {
      res.status(404).json({ success: false, message: 'Payment method not found' });
      return;
    }

    await prisma.paymentMethod.updateMany({
      where: { userId: req.user.id },
      data: { isDefault: false },
    });

    await prisma.paymentMethod.update({
      where: { id: method.id },
      data: { isDefault: true },
    });

    res.json({ success: true, message: 'Default payment card updated' });
  } catch (error) {
    next(error);
  }
});

router.delete('/methods/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const method = await prisma.paymentMethod.findFirst({
      where: { id: req.params.id, userId: req.user.id },
    });

    if (!method) {
      res.status(404).json({ success: false, message: 'Payment method not found' });
      return;
    }

    await prisma.paymentMethod.delete({
      where: { id: method.id },
    });

    if (method.isDefault) {
      const remaining = await prisma.paymentMethod.findFirst({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
      });
      if (remaining) {
        await prisma.paymentMethod.update({
          where: { id: remaining.id },
          data: { isDefault: true },
        });
      }
    }

    res.json({ success: true, message: 'Payment card removed' });
  } catch (error) {
    next(error);
  }
});

// ─── PROCESS PAYMENT (Shared by verify + webhook) ─────────────────────────

async function processPayment(
  reference: string,
  providedPaystackData?: any
): Promise<{ success: boolean; message: string; type?: string }> {
  const existingLog = await prisma.webhookLog.findUnique({ where: { reference } });
  if (existingLog?.processed) {
    return { success: true, message: 'Already processed' };
  }

  await prisma.webhookLog.upsert({
    where: { reference },
    update: {},
    create: { reference, event: 'charge.success', processed: false },
  });

  const transaction = await prisma.transaction.findUnique({
    where: { reference },
    include: { user: true },
  });

  if (!transaction) {
    return { success: false, message: 'Transaction not found' };
  }

  if (transaction.status === 'SUCCESS') {
    await prisma.webhookLog.update({ where: { reference }, data: { processed: true } });
    return { success: true, message: 'Already completed', type: transaction.type };
  }

  try {
    const paystackData = providedPaystackData || (await verifyTransaction(reference));
    if (paystackData?.status !== 'success') {
      await prisma.transaction.update({
        where: { reference },
        data: { status: 'FAILED', paystackData: paystackData as any },
      });
      return { success: false, message: 'Payment verification failed' };
    }

    // ─── CARD VERIFICATION FLOW ───────────────────────────────────────────
    if (transaction.type === 'CARD_VERIFICATION') {
      if (paystackData.authorization?.authorization_code) {
        const auth = paystackData.authorization;
        await prisma.paymentMethod.updateMany({
          where: { userId: transaction.userId },
          data: { isDefault: false },
        });

        await prisma.paymentMethod.upsert({
          where: { authorizationCode: auth.authorization_code },
          update: {
            userId: transaction.userId,
            cardType: auth.card_type || 'card',
            last4: auth.last4 || '0000',
            expMonth: String(auth.exp_month || ''),
            expYear: String(auth.exp_year || ''),
            bank: auth.bank || null,
            brand: auth.brand || auth.card_type || 'card',
            isDefault: true,
          },
          create: {
            userId: transaction.userId,
            authorizationCode: auth.authorization_code,
            cardType: auth.card_type || 'card',
            last4: auth.last4 || '0000',
            expMonth: String(auth.exp_month || ''),
            expYear: String(auth.exp_year || ''),
            bank: auth.bank || null,
            brand: auth.brand || auth.card_type || 'card',
            isDefault: true,
          },
        });
      }

      await prisma.transaction.update({
        where: { reference },
        data: {
          status: 'SUCCESS',
          paystackData: paystackData as any,
        },
      });

      // Auto-refund verification charge so it is free for the user
      try {
        await refundTransaction(reference);
      } catch (err: any) {
        console.error('[Payment] Card verification auto-refund note:', err.message);
      }

      await prisma.webhookLog.update({ where: { reference }, data: { processed: true } });
      return { success: true, message: 'Payment card verified and saved successfully', type: transaction.type };
    }

    // ─── RECURRING BILLING FLOW ───────────────────────────────────────────
    if (transaction.type === 'RECURRING') {
      await prisma.transaction.update({
        where: { reference },
        data: {
          status: 'SUCCESS',
          paystackData: paystackData as any,
        },
      });

      if (transaction.membershipId) {
        const nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await prisma.membership.update({
          where: { id: transaction.membershipId },
          data: { nextBillingDate },
        });

        const membership = await prisma.membership.findUnique({
          where: { id: transaction.membershipId },
          include: { pool: true },
        });

        if (membership) {
          const payoutDueAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
          await prisma.payout.upsert({
            where: { transactionId: transaction.id },
            update: {},
            create: {
              transactionId: transaction.id,
              hostId: membership.pool.hostId,
              amount: transaction.hostPayout,
              status: 'SCHEDULED',
              payoutDueAt,
            },
          });
        }
      }

      await prisma.webhookLog.update({ where: { reference }, data: { processed: true } });
      return { success: true, message: 'Recurring subscription renewal processed', type: transaction.type };
    }

    // ─── POOL JOIN FLOW ───────────────────────────────────────────────────
    const metadata = paystackData?.metadata || (transaction.paystackData as any) || {};
    const poolId = metadata.poolId || (transaction.paystackData as any)?.poolId;
    const userId = transaction.userId;

    if (!poolId) {
      return { success: false, message: 'Missing pool ID' };
    }

    const pool = await prisma.pool.findUnique({
      where: { id: poolId },
      include: { host: true },
    });

    if (!pool) {
      return { success: false, message: 'Pool not found' };
    }

    // ─── DYNAMIC ESCROW CONFIGURATION ──────────────────────────────────────
    const host = await prisma.user.findUnique({
      where: { id: pool.hostId },
      select: { reputationScore: true, successfulPools: true },
    });
    const isNewHost = !host || host.reputationScore < 26 || host.successfulPools === 0;
    const escrowHours = isNewHost ? 168 : 48;
    const escrowEndsAt = new Date(Date.now() + escrowHours * 60 * 60 * 1000);
    const nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Save or update payment method if card is reusable
    if (paystackData.authorization?.authorization_code) {
      const auth = paystackData.authorization;
      await prisma.paymentMethod.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
      await prisma.paymentMethod.upsert({
        where: { authorizationCode: auth.authorization_code },
        update: {
          userId,
          cardType: auth.card_type || 'card',
          last4: auth.last4 || '0000',
          expMonth: String(auth.exp_month || ''),
          expYear: String(auth.exp_year || ''),
          bank: auth.bank || null,
          brand: auth.brand || auth.card_type || 'card',
          isDefault: true,
        },
        create: {
          userId,
          authorizationCode: auth.authorization_code,
          cardType: auth.card_type || 'card',
          last4: auth.last4 || '0000',
          expMonth: String(auth.exp_month || ''),
          expYear: String(auth.exp_year || ''),
          bank: auth.bank || null,
          brand: auth.brand || auth.card_type || 'card',
          isDefault: true,
        },
      });
    }

    const existingMembership = await prisma.membership.findUnique({
      where: { userId_poolId: { userId, poolId } },
    });

    const authCode =
      paystackData.authorization?.authorization_code ||
      existingMembership?.paystackAuthCode ||
      (await prisma.paymentMethod.findFirst({ where: { userId, isDefault: true } }))?.authorizationCode ||
      null;

    // ─── ATOMIC TRANSACTION WITH PESSIMISTIC ROW-LEVEL LOCK ─────────────────
    // Serializes concurrent seat claims for this pool across parallel webhooks/requests
    const txResult = await prisma.$transaction(async (tx) => {
      // 1. Lock Pool row using PostgreSQL row-level lock
      await tx.$queryRaw`SELECT id FROM "Pool" WHERE id = ${poolId} FOR UPDATE`;

      // 2. Count active seats under the lock
      const currentValidSeats = await tx.membership.count({
        where: {
          poolId,
          status: { in: ['ACTIVE', 'IN_ESCROW', 'DISPUTED'] },
        },
      });

      // If user already has an active/escrow membership, don't consume an extra seat
      if (existingMembership && ['ACTIVE', 'IN_ESCROW', 'DISPUTED'].includes(existingMembership.status)) {
        const updated = await tx.membership.update({
          where: { id: existingMembership.id },
          data: {
            escrowEndsAt,
            nextBillingDate,
            paystackAuthCode: authCode,
          },
        });
        await tx.transaction.update({
          where: { reference },
          data: {
            status: 'SUCCESS',
            membershipId: updated.id,
            paystackData: paystackData as any,
          },
        });
        return { success: true, membership: updated, poolFilled: false };
      }

      // Check capacity
      if (currentValidSeats >= pool.totalSeats) {
        // Pool is full! Reject membership creation
        await tx.transaction.update({
          where: { reference },
          data: { status: 'FAILED', paystackData: paystackData as any },
        });
        await tx.pool.update({
          where: { id: poolId },
          data: { status: 'FULL' },
        });
        return { success: false, overCapacity: true };
      }

      // Create or update membership inside lock
      let membershipRecord;
      if (existingMembership) {
        membershipRecord = await tx.membership.update({
          where: { id: existingMembership.id },
          data: {
            status: 'IN_ESCROW',
            escrowEndsAt,
            nextBillingDate,
            paystackAuthCode: authCode,
          },
        });
      } else {
        membershipRecord = await tx.membership.create({
          data: {
            userId,
            poolId,
            status: 'IN_ESCROW',
            escrowEndsAt,
            nextBillingDate,
            paystackAuthCode: authCode,
          },
        });
      }

      await tx.transaction.update({
        where: { reference },
        data: {
          status: 'SUCCESS',
          membershipId: membershipRecord.id,
          paystackData: paystackData as any,
        },
      });

      await tx.payout.upsert({
        where: { transactionId: transaction.id },
        update: {},
        create: {
          transactionId: transaction.id,
          hostId: pool.hostId,
          amount: transaction.hostPayout,
          status: 'PENDING',
        },
      });

      const poolFilled = currentValidSeats + 1 >= pool.totalSeats;
      if (poolFilled) {
        await tx.pool.update({
          where: { id: poolId },
          data: { status: 'FULL' },
        });
      }

      return { success: true, membership: membershipRecord, poolFilled };
    });

    if (!txResult.success || !txResult.membership) {
      // Over capacity: Auto-refund transaction so user is not charged for unavailable seat
      try {
        await refundTransaction(reference);
        await prisma.transaction.update({
          where: { reference },
          data: { status: 'REFUNDED' },
        });
      } catch (refundErr: any) {
        console.error('[Payment] Auto-refund error on over-capacity seat:', refundErr.message);
      }

      await createNotification({
        userId: transaction.userId,
        type: 'PAYMENT_REFUNDED',
        title: 'Pool full — Payment refunded',
        message: `The last seat in "${pool.name}" was taken right before your payment completed. Your payment of ₦${transaction.amount.toLocaleString()} has been refunded.`,
        data: { poolId: pool.id, reference },
      });

      await prisma.webhookLog.update({ where: { reference }, data: { processed: true } });
      return { success: false, message: 'Pool is full. Your payment has been refunded.' };
    }

    const membership = txResult.membership;

    await sendPaymentSuccessEmail(
      transaction.user.email,
      transaction.user.fullName,
      pool.name,
      transaction.amount
    );

    await createNotification({
      userId: transaction.userId,
      type: 'PAYMENT_SUCCESS',
      title: 'Payment successful',
      message: `You joined "${pool.name}" for ₦${transaction.amount.toLocaleString()}. You have ${escrowHours} hours to test the credentials.`,
      data: { poolId: pool.id, membershipId: membership.id, escrowHours },
    });

    await sendNewMemberEmail(
      pool.host.email,
      pool.host.fullName,
      pool.name,
      transaction.user.fullName
    );

    await createNotification({
      userId: pool.hostId,
      type: 'NEW_MEMBER',
      title: 'New member joined',
      message: `${transaction.user.fullName} joined your pool "${pool.name}".`,
      data: { poolId: pool.id, membershipId: membership.id },
    });

    if (txResult.poolFilled && pool.status !== 'FULL') {
      await recalculateHostReputation(pool.hostId);
      await sendPoolFilledEmail(pool.host.email, pool.host.fullName, pool.name);

      await createNotification({
        userId: pool.hostId,
        type: 'POOL_FILLED',
        title: 'Pool is full',
        message: `Your pool "${pool.name}" is now full. All ${pool.totalSeats} seats have been taken.`,
        data: { poolId: pool.id },
      });
    }

    await prisma.webhookLog.update({ where: { reference }, data: { processed: true } });
    return { success: true, message: 'Payment successful', type: transaction.type };
  } catch (error: any) {
    console.error(`[Payment] Processing error for reference ${reference}:`, error.message);
    const currentTx = await prisma.transaction.findUnique({ where: { reference } });
    if (currentTx && currentTx.status !== 'SUCCESS') {
      await prisma.transaction.update({ where: { reference }, data: { status: 'FAILED' } });
    }
    return { success: false, message: error.message || 'Processing failed' };
  }
}

export default router;