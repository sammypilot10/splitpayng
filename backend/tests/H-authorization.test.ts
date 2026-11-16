import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import {
  app,
  prisma,
  resetDb,
  resetMocks,
  signCookie,
  createUser,
  createHostWithPool,
  createMembership,
} from './helpers/index.js';

describe('H - Authorization and Access Control Tests', () => {
  beforeEach(async () => {
    await resetDb();
    resetMocks();
  });

  it('H1: every protected route returns 401 without a cookie', async () => {
    const endpoints = [
      // Auth
      { method: 'post', url: '/api/auth/resend-verification' },
      { method: 'get', url: '/api/auth/me' },
      // Pools
      { method: 'post', url: '/api/pools' },
      { method: 'patch', url: '/api/pools/test-id/credentials' },
      // Payments
      { method: 'post', url: '/api/payments/initialize' },
      { method: 'get', url: '/api/payments/methods' },
      { method: 'post', url: '/api/payments/methods/initialize-add' },
      { method: 'patch', url: '/api/payments/methods/test-id/default' },
      { method: 'delete', url: '/api/payments/methods/test-id' },
      // Memberships
      { method: 'get', url: '/api/memberships/my' },
      { method: 'get', url: '/api/memberships/host' },
      { method: 'post', url: '/api/memberships/test-id/decrypt' },
      { method: 'post', url: '/api/memberships/test-id/share-password' },
      { method: 'post', url: '/api/memberships/test-id/confirm' },
      { method: 'post', url: '/api/memberships/test-id/dispute' },
      { method: 'post', url: '/api/memberships/test-id/report-broken' },
      { method: 'get', url: '/api/memberships/test-id/dispute/messages' },
      { method: 'post', url: '/api/memberships/test-id/dispute/messages' },
      { method: 'post', url: '/api/memberships/test-id/dispute/evidence' },
      { method: 'get', url: '/api/memberships/test-id/dispute/evidence' },
      { method: 'post', url: '/api/memberships/test-id/cancel' },
      // Banks
      { method: 'post', url: '/api/banks/resolve' },
      { method: 'post', url: '/api/banks/setup' },
      { method: 'get', url: '/api/banks/my' },
      { method: 'get', url: '/api/banks/payouts' },
      // Disputes
      { method: 'get', url: '/api/disputes' },
      // Admin
      { method: 'get', url: '/api/admin/disputes' },
      { method: 'get', url: '/api/admin/disputes/test-id/timeline' },
      { method: 'get', url: '/api/admin/disputes/test-id/messages' },
      { method: 'get', url: '/api/admin/disputes/test-id/evidence' },
      { method: 'post', url: '/api/admin/disputes/test-id/messages' },
      { method: 'post', url: '/api/admin/disputes/test-id/notes' },
      { method: 'post', url: '/api/admin/disputes/test-id/resolve' },
      { method: 'post', url: '/api/admin/payouts/test-id/requeue' },
      // Uploads
      { method: 'get', url: '/api/uploads/test-file.png' },
      // Notifications
      { method: 'get', url: '/api/notifications' },
      { method: 'get', url: '/api/notifications/unread-count' },
      { method: 'post', url: '/api/notifications/test-id/read' },
      { method: 'post', url: '/api/notifications/read-all' },
      { method: 'delete', url: '/api/notifications/test-id' },
      { method: 'delete', url: '/api/notifications/clear-read' },
    ];

    for (const ep of endpoints) {
      const req = (request(app) as any)[ep.method](ep.url);
      const res = await req;
      expect(res.status).toBe(401);
    }
  });

  it('H2: /api/admin/* returns 403 for non-admins', async () => {
    const memberUser = await createUser({ role: 'MEMBER' });
    const hostUser = await createUser({ role: 'HOST' });

    const memberCookie = signCookie(memberUser);
    const hostCookie = signCookie(hostUser);

    const adminEndpoints = [
      { method: 'get', url: '/api/admin/disputes' },
      { method: 'get', url: '/api/admin/disputes/test-id/timeline' },
      { method: 'get', url: '/api/admin/disputes/test-id/messages' },
      { method: 'get', url: '/api/admin/disputes/test-id/evidence' },
      { method: 'post', url: '/api/admin/disputes/test-id/messages', body: { message: 'hello' } },
      { method: 'post', url: '/api/admin/disputes/test-id/notes', body: { note: 'note' } },
      { method: 'post', url: '/api/admin/disputes/test-id/resolve', body: { resolution: 'REFUND' } },
      { method: 'post', url: '/api/admin/payouts/test-id/requeue' },
    ];

    for (const cookie of [memberCookie, hostCookie]) {
      for (const ep of adminEndpoints) {
        let req = (request(app) as any)[ep.method](ep.url).set('Cookie', cookie);
        if (ep.body) {
          req = req.send(ep.body);
        }
        const res = await req;
        expect(res.status).toBe(403);
      }
    }
  });

  it('H3: user B cannot read user A\'s dispute messages/evidence or confirm/cancel A\'s membership', async () => {
    const { host, pool } = await createHostWithPool();
    const userA = await createUser({ email: 'usera@example.com', role: 'MEMBER' });
    const userB = await createUser({ email: 'userb@example.com', role: 'MEMBER' });

    const membershipA = await createMembership({
      userId: userA.id,
      poolId: pool.id,
      status: 'IN_ESCROW',
    });

    const dispute = await prisma.dispute.create({
      data: {
        membershipId: membershipA.id,
        memberId: userA.id,
        reason: 'BROKEN_CREDENTIALS',
        status: 'OPEN',
      },
    });

    await prisma.disputeMessage.create({
      data: {
        disputeId: dispute.id,
        senderId: userA.id,
        senderRole: 'MEMBER',
        message: 'A secret dispute message',
      },
    });

    await prisma.disputeEvidence.create({
      data: {
        disputeId: dispute.id,
        uploadedBy: userA.id,
        role: 'MEMBER',
        fileUrl: '/uploads/evidence.png',
        fileName: 'evidence.png',
      },
    });

    const cookieB = signCookie(userB);

    const checks = [
      { method: 'get', url: `/api/memberships/${membershipA.id}/dispute/messages` },
      { method: 'post', url: `/api/memberships/${membershipA.id}/dispute/messages`, body: { message: 'hi' } },
      { method: 'get', url: `/api/memberships/${membershipA.id}/dispute/evidence` },
      { method: 'post', url: `/api/memberships/${membershipA.id}/confirm` },
      { method: 'post', url: `/api/memberships/${membershipA.id}/cancel` },
    ];

    for (const check of checks) {
      let req = (request(app) as any)[check.method](check.url).set('Cookie', cookieB);
      if (check.body) {
        req = req.send(check.body);
      }
      const res = await req;
      expect([403, 404]).toContain(res.status);
    }

    const mInDb = await prisma.membership.findUnique({ where: { id: membershipA.id } });
    expect(mInDb?.status).toBe('IN_ESCROW');
  });

  it('H4: a host cannot read credentials of a pool they do not own', async () => {
    const { host: hostA, pool: poolA } = await createHostWithPool({ passphrase: 'HostASecret123' });
    const hostB = await createUser({ email: 'hostb@example.com', role: 'HOST' });
    const member = await createUser({ email: 'member@example.com', role: 'MEMBER' });

    const membership = await createMembership({
      userId: member.id,
      poolId: poolA.id,
      status: 'ACTIVE',
    });

    const cookieHostB = signCookie(hostB);

    // Assert GET /api/pools and GET /api/pools/${poolA.id} do NOT expose encryptedCredentials
    const resPools = await request(app).get('/api/pools');
    expect(resPools.status).toBe(200);
    const foundPool = resPools.body.data.find((p: any) => p.id === poolA.id);
    if (foundPool) {
      expect(foundPool.encryptedCredentials).toBeUndefined();
    }

    const resPoolOne = await request(app).get(`/api/pools/${poolA.id}`);
    expect(resPoolOne.status).toBe(200);
    expect(resPoolOne.body.data.encryptedCredentials).toBeUndefined();

    // As hostB:
    const resDecrypt = await request(app)
      .post(`/api/memberships/${membership.id}/decrypt`)
      .set('Cookie', cookieHostB)
      .send({ encryptionPassword: 'HostASecret123' });
    expect([403, 404]).toContain(resDecrypt.status);

    const resShare = await request(app)
      .post(`/api/memberships/${membership.id}/share-password`)
      .set('Cookie', cookieHostB)
      .send({ encryptionPassword: 'HostASecret123' });
    expect(resShare.status).toBe(403);

    const resPatch = await request(app)
      .patch(`/api/pools/${poolA.id}/credentials`)
      .set('Cookie', cookieHostB)
      .send({ encryptedCredentials: 'hijacked' });
    expect(resPatch.status).toBe(403);
  });

  it('H5: GET /api/uploads/* requires auth and ownership/party check', async () => {
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const testFileName = 'test-h5-evidence.png';
    const testFilePath = path.resolve(uploadsDir, testFileName);
    fs.writeFileSync(testFilePath, 'dummy image content');

    try {
      const { host, pool } = await createHostWithPool();
      const userA = await createUser({ email: 'usera5@example.com', role: 'MEMBER' });
      const userC = await createUser({ email: 'userc5@example.com', role: 'MEMBER' });

      const membershipA = await createMembership({
        userId: userA.id,
        poolId: pool.id,
        status: 'IN_ESCROW',
      });

      const dispute = await prisma.dispute.create({
        data: {
          membershipId: membershipA.id,
          memberId: userA.id,
          reason: 'BROKEN_CREDENTIALS',
          status: 'OPEN',
        },
      });

      await prisma.disputeEvidence.create({
        data: {
          disputeId: dispute.id,
          uploadedBy: userA.id,
          role: 'MEMBER',
          fileUrl: `/uploads/${testFileName}`,
          fileName: testFileName,
        },
      });

      // 1. Unauthenticated request -> 401
      const resUnauth = await request(app).get(`/api/uploads/${testFileName}`);
      expect(resUnauth.status).toBe(401);

      // 2. Unrelated userC request -> expect 403 or 404
      const cookieC = signCookie(userC);
      const resC = await request(app)
        .get(`/api/uploads/${testFileName}`)
        .set('Cookie', cookieC);
      expect([403, 404]).toContain(resC.status);
    } finally {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    }
  });
});
