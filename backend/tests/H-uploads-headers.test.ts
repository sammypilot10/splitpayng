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

describe('H - Upload response headers & content safety', () => {
  beforeEach(async () => {
    await resetDb();
    resetMocks();
  });

  it('serves evidence to authorized parties with strict security headers and allowlisted Content-Type, and denies unauthorized users with no content', async () => {
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    const pngFile = 'test-headers-evidence.png';
    const jpgFile = 'test-headers-photo.jpg';
    const svgFile = 'test-headers-blocked.svg';
    const pngPath = path.resolve(uploadsDir, pngFile);
    const jpgPath = path.resolve(uploadsDir, jpgFile);
    const svgPath = path.resolve(uploadsDir, svgFile);

    const pngContent = 'SECRET_PNG_EVIDENCE_BYTES';
    const jpgContent = 'SECRET_JPG_EVIDENCE_BYTES';
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

    fs.writeFileSync(pngPath, pngContent);
    fs.writeFileSync(jpgPath, jpgContent);
    fs.writeFileSync(svgPath, svgContent);

    try {
      const { host, pool } = await createHostWithPool();
      const member = await createUser({ email: 'member-hdr@example.com', role: 'MEMBER' });
      const outsider = await createUser({ email: 'outsider-hdr@example.com', role: 'MEMBER' });
      const admin = await createUser({ email: 'admin-hdr@example.com', role: 'ADMIN' });

      const membership = await createMembership({
        userId: member.id,
        poolId: pool.id,
        status: 'DISPUTED',
      });

      const dispute = await prisma.dispute.create({
        data: {
          membershipId: membership.id,
          memberId: member.id,
          reason: 'BROKEN_CREDENTIALS',
          status: 'OPEN',
        },
      });

      await prisma.disputeEvidence.createMany({
        data: [
          {
            disputeId: dispute.id,
            uploadedBy: member.id,
            role: 'MEMBER',
            fileUrl: `/uploads/${pngFile}`,
            fileName: pngFile,
          },
          {
            disputeId: dispute.id,
            uploadedBy: host.id,
            role: 'HOST',
            fileUrl: `/uploads/${jpgFile}`,
            fileName: jpgFile,
          },
          {
            disputeId: dispute.id,
            uploadedBy: member.id,
            role: 'MEMBER',
            fileUrl: `/uploads/${svgFile}`,
            fileName: svgFile,
          },
        ],
      });

      const memberCookie = signCookie(member);
      const hostCookie = signCookie(host);
      const adminCookie = signCookie(admin);
      const outsiderCookie = signCookie(outsider);

      // 1. Authorized requests (member, host, admin) get 200 + all required security headers.
      for (const cookie of [memberCookie, hostCookie, adminCookie]) {
        const resPng = await request(app)
          .get(`/api/uploads/${pngFile}`)
          .set('Cookie', cookie);

        expect(resPng.status).toBe(200);
        expect(resPng.headers['content-type']).toBe('image/png');
        expect(resPng.headers['content-disposition']).toBe(`inline; filename="${pngFile}"`);
        expect(resPng.headers['x-content-type-options']).toBe('nosniff');
        expect(resPng.headers['cache-control']).toBe('private, no-store');
        expect(resPng.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
        expect(Buffer.from(resPng.body).toString('utf8')).toBe(pngContent);
      }

      // Allowlisted .jpg maps to image/jpeg.
      const resJpg = await request(app)
        .get(`/api/uploads/${jpgFile}`)
        .set('Cookie', memberCookie);
      expect(resJpg.status).toBe(200);
      expect(resJpg.headers['content-type']).toBe('image/jpeg');
      expect(resJpg.headers['content-disposition']).toBe(`inline; filename="${jpgFile}"`);
      expect(resJpg.headers['x-content-type-options']).toBe('nosniff');
      expect(resJpg.headers['cache-control']).toBe('private, no-store');
      expect(resJpg.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
      expect(Buffer.from(resJpg.body).toString('utf8')).toBe(jpgContent);

      // 2. Unauthorized user gets 403 and no file content.
      const resOutsider = await request(app)
        .get(`/api/uploads/${pngFile}`)
        .set('Cookie', outsiderCookie);
      expect(resOutsider.status).toBe(403);
      expect(resOutsider.text).not.toContain(pngContent);

      // 3. Disallowed extension (.svg) is blocked with 403 and no file content even for authorized users.
      const resSvg = await request(app)
        .get(`/api/uploads/${svgFile}`)
        .set('Cookie', memberCookie);
      expect(resSvg.status).toBe(403);
      expect(resSvg.text).not.toContain('<svg');
    } finally {
      for (const p of [pngPath, jpgPath, svgPath]) {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      }
    }
  });
});
