import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }

        const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);

        const notifications = await prisma.notification.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: 'desc' },
            take: limit,
        });

        res.json({ success: true, data: notifications });
    } catch (error) {
        next(error);
    }
});

router.get('/unread-count', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }

        const count = await prisma.notification.count({
            where: { userId: req.user.id, read: false },
        });

        res.json({ success: true, data: { count } });
    } catch (error) {
        next(error);
    }
});

router.post('/:id/read', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }

        await prisma.notification.updateMany({
            where: { id: req.params.id, userId: req.user.id },
            data: { read: true },
        });

        res.json({ success: true, message: 'Marked as read' });
    } catch (error) {
        next(error);
    }
});

router.post('/read-all', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }

        await prisma.notification.updateMany({
            where: { userId: req.user.id, read: false },
            data: { read: true },
        });

        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
        next(error);
    }
});

router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }

        await prisma.notification.deleteMany({
            where: { id: req.params.id, userId: req.user.id },
        });

        res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        next(error);
    }
});

router.delete('/clear-read', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }

        const result = await prisma.notification.deleteMany({
            where: { userId: req.user.id, read: true },
        });

        res.json({ success: true, message: `Cleared ${result.count} read notifications` });
    } catch (error) {
        next(error);
    }
});

export default router;