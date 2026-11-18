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

        if (!fs.existsSync(resolvedPath)) {
            res.status(404).json({ success: false, message: 'File not found' });
            return;
        }

        res.sendFile(resolvedPath);
    } catch (error) {
        next(error);
    }
});

export default router;