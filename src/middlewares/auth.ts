import { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';

// req.user を TypeScript に認識させるための拡張
export interface AuthRequest extends Request {
  user?: { id: string };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction): any => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ detail: '認証トークンがありません' });
  }

  jwt.verify(token, env.jwtSecret, (err, decoded) => {
    if (err) {
      return res.status(401).json({ detail: '無効なトークンです' });
    }

    const payload = decoded as JwtPayload;
    if (typeof payload?.sub !== 'string') {
      return res.status(401).json({ detail: '無効なトークンです' });
    }
    if (payload.type && payload.type !== 'access') {
      return res.status(401).json({ detail: '無効なトークンです' });
    }

    req.user = { id: payload.sub };
    next();
  });
};
