import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { fileTypeFromFile } from 'file-type';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        cb(null, `${unique}${path.extname(file.originalname)}`);
    },
});

const ALLOWED_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
]);

export const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        if (!allowedExts.includes(ext)) {
            (cb as any)(new Error('Invalid file extension. Only PNG, JPG, GIF, WEBP allowed.'));
            return;
        }
        cb(null, true);
    },
});

export async function validateFileType(req: any, res: any, next: any) {
    if (!req.file) {
        next();
        return;
    }

    try {
        const fileType = await fileTypeFromFile(req.file.path);

        if (!fileType || !ALLOWED_TYPES.has(fileType.mime)) {
            fs.unlinkSync(req.file.path);
            res.status(400).json({
                success: false,
                message: 'Invalid file type. Only PNG, JPG, GIF, and WEBP images are allowed.',
            });
            return;
        }

        const ext = path.extname(req.file.originalname).toLowerCase();
        const expectedExts: Record<string, string[]> = {
            'image/png': ['.png'],
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/gif': ['.gif'],
            'image/webp': ['.webp'],
        };

        if (!expectedExts[fileType.mime]?.includes(ext)) {
            fs.unlinkSync(req.file.path);
            res.status(400).json({
                success: false,
                message: 'File extension does not match actual file content.',
            });
            return;
        }

        next();
    } catch (err) {
        if (req.file?.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(400).json({
            success: false,
            message: 'Failed to validate uploaded file.',
        });
    }
}