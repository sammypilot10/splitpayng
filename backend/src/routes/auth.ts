import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendMagicLinkEmail, sendPasswordResetEmail, sendVerificationEmail } from '../utils/email.js';
import { validate } from '../middleware/validate.js';
import {
  registerSchema,
  loginSchema,
  magicLinkSchema,
  verifyMagicLinkSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../validation/index.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET as string;
const isProd = process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
} as const;

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  emailVerified: true,
  reputationScore: true,
  successfulPools: true,
  totalDisputes: true,
  totalMembersServed: true,
  hostSince: true,
} as const;

function formatUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    emailVerified: user.emailVerified,
    reputationScore: user.reputationScore,
    successfulPools: user.successfulPools,
    totalDisputes: user.totalDisputes,
    totalMembersServed: user.totalMembersServed,
    hostSince: user.hostSince?.toISOString() || null,
  };
}

// ─── REGISTER ──────────────────────────────────────────────────────────────

router.post('/register', validate({ body: registerSchema }), async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ success: false, message: 'Email already registered' });
      return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, fullName, role: 'MEMBER' },
    });

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: verifyToken,
        passwordResetExpires: verifyExpires,
      },
    });

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
    console.log(`[DEV] Email verification URL for ${email}: ${verifyUrl}`);
    await sendVerificationEmail(user.email, user.fullName, verifyUrl);

    const token = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.cookie('token', token, COOKIE_OPTIONS);
    res.status(201).json({
      success: true,
      data: { user: formatUser(user) },
    });
  } catch (error) {
    next(error);
  }
});

// ─── LOGIN ─────────────────────────────────────────────────────────────────

router.post('/login', validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
      return;
    }
    const token = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({
      success: true,
      data: { user: formatUser(user) },
    });
  } catch (error) {
    next(error);
  }
});

// ─── VERIFY EMAIL ──────────────────────────────────────────────────────────

router.post('/verify-email', validate({ body: verifyEmailSchema }), async (req, res, next) => {
  try {
    const { token } = req.body;

    const user = await prisma.user.findFirst({
      where: { passwordResetToken: token },
    });

    if (!user) {
      res.status(400).json({ success: false, message: 'Invalid or expired verification token' });
      return;
    }

    if (!user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      res.status(400).json({ success: false, message: 'Verification token has expired. Please request a new one.' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    res.json({ success: true, message: 'Email verified successfully. You can now create pools and receive payouts.' });
  } catch (error: any) {
    if (error.code === 'P1001') {
      res.status(503).json({ success: false, message: 'Database is waking up. Please try again in 5 seconds.' });
      return;
    }
    next(error);
  }
});

// ─── RESEND VERIFICATION EMAIL ─────────────────────────────────────────────

router.post('/resend-verification', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (user.emailVerified) {
      res.status(400).json({ success: false, message: 'Email is already verified' });
      return;
    }

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: verifyToken,
        passwordResetExpires: verifyExpires,
      },
    });

    const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}`;
    console.log(`[DEV] Email verification URL for ${user.email}: ${verifyUrl}`);
    await sendVerificationEmail(user.email, user.fullName, verifyUrl);

    res.json({ success: true, message: 'Verification email sent. Please check your inbox.' });
  } catch (error) {
    next(error);
  }
});

// ─── MAGIC LINK ────────────────────────────────────────────────────────────

router.post('/magic-link', validate({ body: magicLinkSchema }), async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    const token = jwt.sign(
      { userId: user.id, type: 'magic' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );
    const link = `${process.env.FRONTEND_URL}/auth/verify-magic-link?token=${token}`;
    await sendMagicLinkEmail(user.email, user.fullName, link);
    res.json({ success: true, message: 'Magic link sent to your email' });
  } catch (error) {
    next(error);
  }
});

router.post('/verify-magic-link', validate({ body: verifyMagicLinkSchema }), async (req, res, next) => {
  try {
    const { token } = req.body;
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; type: string };
    if (decoded.type !== 'magic') {
      res.status(400).json({ success: false, message: 'Invalid token type' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    const authToken = jwt.sign(
      { userId: user.id, role: user.role, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.cookie('token', authToken, COOKIE_OPTIONS);
    res.json({
      success: true,
      data: { user: formatUser(user) },
    });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Invalid or expired magic link' });
  }
});

// ─── FORGOT PASSWORD ───────────────────────────────────────────────────────

router.post('/forgot-password', validate({ body: forgotPasswordSchema }), async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpires: resetExpires,
      },
    });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    console.log(`[DEV] Password reset URL for ${email}: ${resetUrl}`);
    await sendPasswordResetEmail(user.email, user.fullName, resetUrl);

    res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
  } catch (error) {
    next(error);
  }
});

// ─── RESET PASSWORD ────────────────────────────────────────────────────────

router.post('/reset-password', validate({ body: resetPasswordSchema }), async (req, res, next) => {
  try {
    const { token, password } = req.body;

    const user = await prisma.user.findFirst({
      where: { passwordResetToken: token },
    });

    if (!user) {
      res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
      return;
    }

    if (!user.passwordResetExpires || user.passwordResetExpires < new Date()) {
      res.status(400).json({ success: false, message: 'Reset token has expired. Please request a new one.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    res.clearCookie('token', {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
    });

    res.json({ success: true, message: 'Password reset successful. Please sign in with your new password.' });
  } catch (error) {
    next(error);
  }
});

// ─── ME / LOGOUT ───────────────────────────────────────────────────────────

router.get('/me', async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string; email: string };
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: USER_SELECT,
    });
    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }
    res.json({ success: true, data: formatUser(user) });
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
});

router.post('/logout', (_req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
  });
  res.json({ success: true, message: 'Logged out' });
});

export default router;