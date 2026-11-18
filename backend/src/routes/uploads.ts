import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { prisma } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

function sanitizeFilename(filePath: string, ext: string): string {
    const base = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_');
    return base && !base.startsWith('.') ? base : `evidence${ext}`;
}

router.get('/:path(*)', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }

        const uploadsRoot = path.resolve(__dirname, '../../uploads');
        const resolvedPath = path.resolve(uploadsRoot, req.params.path);
        const relativePath = path.relative(uploadsRoot, resolvedPath);

        if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            res.status(403).json({ success: false, message: 'Access denied' });
            return;
        }

        if (req.user.role !== 'ADMIN') {
            const normalizedRelative = relativePath.split(path.sep).join('/');
            const evidences = await prisma.disputeEvidence.findMany({
                where: {
                    fileUrl: {
                        in: [`/uploads/${normalizedRelative}`, `/api/uploads/${normalizedRelative}`],
                    },
                },
                include: {
                    dispute: {
                        include: {
                            membership: {
                                include: {
                                    pool: { select: { hostId: true } },
                                },
                            },
                        },
                    },
                },
            });

            const isAuthorized = evidences.some(
                (ev) =>
                    ev.uploadedBy === req.user!.id ||
                    ev.dispute.memberId === req.user!.id ||
                    ev.dispute.membership.userId === req.user!.id ||
                    ev.dispute.membership.pool.hostId === req.user!.id
            );

            if (!isAuthorized) {
                res.status(403).json({ success: false, message: 'Access denied' });
                return;
            }
        }

        const ext = path.extname(resolvedPath).toLowerCase();
        const contentType = ALLOWED_CONTENT_TYPES[ext];
        if (!contentType) {
            res.status(403).json({ success: false, message: 'Unsupported file type' });
            return;
        }

        if (!fs.existsSync(resolvedPath)) {
            res.status(404).json({ success: false, message: 'File not found' });
            return;
        }

        const safeFileName = sanitizeFilename(resolvedPath, ext);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

        res.sendFile(resolvedPath, { cacheControl: false });
    } catch (error) {
        next(error);
    }
});

export default router;