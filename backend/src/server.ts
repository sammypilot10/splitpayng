import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './db.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import poolRoutes from './routes/pools.js';
import paymentRoutes from './routes/payments.js';
import membershipRoutes from './routes/memberships.js';
import bankRoutes from './routes/bank.js';
import disputeRoutes from './routes/disputes.js';
import adminRoutes from './routes/admin.js';
import uploadRoutes from './routes/uploads.js';
import notificationRoutes from './routes/notifications.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const isDev = process.env.NODE_ENV !== 'production';

app.use(cors({
    origin: [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        process.env.FRONTEND_URL,
    ].filter(Boolean) as string[],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Rate Limiters ─────────────────────────────────────────────────────────

// Helper: skip rate limiting for localhost in development
const skipLocalhost = (req: express.Request) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    return isDev && (
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        ip?.startsWith('::ffff:192.168.') ||
        ip?.startsWith('192.168.')
    );
};

// Auth routes: 20 attempts per minute (was 5 per 15 minutes!)
const authLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 20,
    skip: skipLocalhost,
    skipSuccessfulRequests: true,
    message: { success: false, message: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// General routes: 500 requests per minute (was 100 per 15 minutes!)
const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 500,
    skip: skipLocalhost,
    message: { success: false, message: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(helmet({
    contentSecurityPolicy: isDev ? false : undefined,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// SECURITY: Do NOT serve /uploads as a public static directory.
// Evidence files are served through the authenticated /api/uploads route instead.
// app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Apply general limiter to all routes
app.use(generalLimiter);
app.use(cookieParser());
// Capture raw body bytes for Paystack webhook HMAC verification.
// The `verify` callback runs before JSON parsing, giving us the exact
// bytes Paystack signed so we can reproduce the HMAC deterministically.
app.use(express.json({
  verify: (req: any, _res, buf) => {
    // Only store rawBody for the webhook route to keep memory usage low
    if (req.url === '/webhook' || req.originalUrl?.endsWith('/webhook')) {
      req.rawBody = buf;
    }
  },
}));

app.get('/api/health', (_req, res) => {
    res.json({ success: true, message: 'SplitPayNG API is running' });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/pools', poolRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/memberships', membershipRoutes);
app.use('/api/banks', bankRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/notifications', notificationRoutes);

app.use(errorHandler);

app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);

    try {
        const { runJobs } = await import('./job/scheduler.js');
        await runJobs();
        console.log('[Cron] Jobs scheduled successfully');
    } catch (err: any) {
        console.error('[Cron] Failed to start jobs:', err.message);
    }
});

process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
});