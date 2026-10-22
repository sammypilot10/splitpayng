import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;

export interface AuthenticatedRequest extends Request {
  user?: { id: string; role: string; email: string };
}

export const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const token = req.cookies?.token;
  if (!token) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string; email: string };
    req.user = { id: decoded.userId, role: decoded.role, email: decoded.email };
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

export const roleMiddleware = (role: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || req.user.role !== role) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }
    next();
  };
};