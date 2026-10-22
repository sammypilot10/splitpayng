import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authMiddleware } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

router.get('/:path(*)', authMiddleware, (req, res, next) => {
    try {
        const uploadsRoot = path.resolve(__dirname, '../../uploads');
        const filePath = path.join(uploadsRoot, req.params.path);
        const resolvedPath = path.resolve(filePath);

        if (!resolvedPath.startsWith(uploadsRoot)) {
            res.status(403).json({ success: false, message: 'Access denied' });
            return;
        }

        if (!fs.existsSync(filePath)) {
            res.status(404).json({ success: false, message: 'File not found' });
            return;
        }

        res.sendFile(filePath);
    } catch (error) {
        next(error);
    }
});

export default router;