import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { app, prisma, resetDb, resetMocks } from './helpers/index.js';

describe('Group I: Infrastructure checks', () => {
    beforeEach(async () => {
        await resetDb();
        resetMocks();
    });

    it('I1: rate limiter must not share one bucket across different X-Forwarded-For clients', async () => {
        /*
         * Trust proxy is required so Express/rate-limit distinguishes proxied X-Forwarded-For
         * clients instead of reading loopback req.ip and sharing/skipping buckets.
         */
        expect(Boolean(app.get('trust proxy'))).toBe(true);

        // Send 21 requests from first IP (203.0.113.10) to trigger rate limit (max 20)
        let lastRes;
        for (let i = 0; i < 21; i++) {
            lastRes = await request(app)
                .post('/api/auth/login')
                .set('X-Forwarded-For', '203.0.113.10')
                .send({ email: 'nobody@example.com', password: 'wrongpassword' });
        }
        expect(lastRes?.status).toBe(429);

        // Send a request from a different IP (198.51.100.20), should not be rate-limited
        const otherRes = await request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', '198.51.100.20')
            .send({ email: 'nobody@example.com', password: 'wrongpassword' });
        expect(otherRes.status).toBe(401);
    });

    it('I2: /api/health should fail when the DB is unreachable', async () => {
        const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('Database connection refused'));
        try {
            const res = await request(app).get('/api/health');
            expect(res.status).toBeGreaterThanOrEqual(500);
            expect(res.body.success).toBe(false);
        } finally {
            spy.mockRestore();
        }
    });
});
