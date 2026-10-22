import { PrismaClient } from '@prisma/client';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

export const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

// Retry middleware for Neon sleep / connection drops
prisma.$use(async (params, next) => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await next(params);
        } catch (err: any) {
            const isConnectionError = err.code === 'P1001' || err.code === 'P1002' || err.code === 'P1017';
            const isLastAttempt = attempt === MAX_RETRIES;

            if (isConnectionError && !isLastAttempt) {
                console.warn(`[Prisma] Query failed (${err.code}), retrying ${attempt}/${MAX_RETRIES} in ${RETRY_DELAY_MS}ms...`);
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                continue;
            }
            throw err;
        }
    }
    throw new Error('Query failed after max retries');
});

// Initial connection with retry
async function connectWithRetry() {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await prisma.$connect();
            await prisma.$queryRaw`SELECT 1`;
            console.log('Database connected successfully');
            return;
        } catch (err: any) {
            const msg = err.message?.includes("Can't reach database server")
                ? "Neon idle timeout"
                : err.message;
            console.warn(`[DB] Connection attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`);

            if (attempt === MAX_RETRIES) {
                console.error('[DB] Could not connect to database after max retries');
                process.exit(1);
            }
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
    }
}

connectWithRetry();

// Keep-alive ping every 3 minutes to prevent Neon from sleeping
setInterval(async () => {
    try {
        await prisma.$queryRaw`SELECT 1`;
    } catch (err: any) {
        console.warn(`[DB] Keep-alive ping failed: ${err.message}`);
    }
}, 3 * 60 * 1000);