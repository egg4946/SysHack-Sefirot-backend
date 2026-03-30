import bcrypt from 'bcrypt';
import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import prisma from '../lib/prisma';
import { authenticateToken } from '../middlewares/auth';
import { createRateLimit } from '../middlewares/rateLimit';

const router = Router();
const signupRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 20 });
const signinRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 10 });
const refreshRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 30 });
const revokedRefreshTokens = new Map<string, number>();

const sanitizeEmail = (email: unknown): string | null => {
  if (typeof email !== 'string') {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const isStrongPassword = (password: unknown): password is string => {
  return typeof password === 'string' && password.length >= 1;
};

const sanitizeDisplayName = (displayName: unknown): string | null => {
  if (typeof displayName !== 'string') {
    return null;
  }

  const normalized = displayName.trim();
  if (normalized.length < 1 || normalized.length > 80) {
    return null;
  }
  return normalized;
};

// ✨ 修正: createdAt に .toISOString() を追加してYAML仕様書と完全一致させる
const formatUser = (user: { id: string; email: string; displayName: string; createdAt: Date }) => {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    created_at: user.createdAt.toISOString(),
  };
};

const createAccessToken = (userId: string): string => {
  return jwt.sign({ sub: userId, type: 'access' }, env.jwtSecret, { expiresIn: '1h' });
};

const createRefreshToken = (userId: string): string => {
  return jwt.sign({ sub: userId, type: 'refresh' }, env.jwtSecret, { expiresIn: '7d' });
};

const getTokenExpiryMs = (token: string): number => {
  const decoded = jwt.decode(token) as jwt.JwtPayload | null;
  if (decoded?.exp && Number.isFinite(decoded.exp)) {
    return decoded.exp * 1000;
  }
  return Date.now() + 7 * 24 * 60 * 60 * 1000;
};

const revokeRefreshToken = (token: string): void => {
  revokedRefreshTokens.set(token, getTokenExpiryMs(token));
};

const isRevokedRefreshToken = (token: string): boolean => {
  const expiresAt = revokedRefreshTokens.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    revokedRefreshTokens.delete(token);
    return false;
  }
  return true;
};

// 新規登録 ( /api/v1/auth/signup )
router.post('/signup', signupRateLimit, async (req: Request, res: Response): Promise<any> => {
  try {
    const email = sanitizeEmail(req.body.email);
    const password = req.body.password;
    const displayName = sanitizeDisplayName(req.body.display_name);

    if (!email || !displayName || !isStrongPassword(password)) {
      return res.status(400).json({
        detail: '入力が不正です。email/display_name/passwordを確認してください',
      });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ detail: 'このメールアドレスは既に登録されています' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: { email, hashedPassword, displayName },
    });

    const accessToken = createAccessToken(newUser.id);
    const refreshToken = createRefreshToken(newUser.id);

    return res.status(200).json({
      user: formatUser(newUser),
      access_token: accessToken,
      refresh_token: refreshToken,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'サーバーエラーが発生しました' });
  }
});

// ログイン ( /api/v1/auth/signin )
router.post('/signin', signinRateLimit, async (req: Request, res: Response): Promise<any> => {
  try {
    const email = sanitizeEmail(req.body.email);
    const password = req.body.password;

    if (!email || !isStrongPassword(password)) {
      return res.status(400).json({ detail: '入力が不正です。email/passwordを確認してください' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ detail: 'メールアドレスまたはパスワードが間違っています' });
    }

    const isValidPassword = await bcrypt.compare(password, user.hashedPassword);
    if (!isValidPassword) {
      return res.status(401).json({ detail: 'メールアドレスまたはパスワードが間違っています' });
    }

    const accessToken = createAccessToken(user.id);
    const refreshToken = createRefreshToken(user.id);

    return res.status(200).json({
      user: formatUser(user),
      access_token: accessToken,
      refresh_token: refreshToken,
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'サーバーエラーが発生しました' });
  }
});

router.post('/refresh', refreshRateLimit, async (req: Request, res: Response): Promise<any> => {
  try {
    const refreshToken = typeof req.body.refresh_token === 'string' ? req.body.refresh_token : null;
    if (!refreshToken) {
      return res.status(400).json({ detail: 'refresh_tokenが必要です' });
    }

    if (isRevokedRefreshToken(refreshToken)) {
      return res.status(401).json({ detail: '無効なトークンです' });
    }

    const decoded = jwt.verify(refreshToken, env.jwtSecret) as jwt.JwtPayload;
    if (decoded.type !== 'refresh' || typeof decoded.sub !== 'string') {
      return res.status(401).json({ detail: '無効なトークンです' });
    }

    const newAccessToken = createAccessToken(decoded.sub);
    const newRefreshToken = createRefreshToken(decoded.sub);
    revokeRefreshToken(refreshToken);

    return res.status(200).json({ access_token: newAccessToken, refresh_token: newRefreshToken });
  } catch {
    return res.status(401).json({ detail: '無効なトークンです' });
  }
});

router.post('/logout', authenticateToken, async (req: Request, res: Response): Promise<any> => {
  try {
    const refreshToken = typeof req.body.refresh_token === 'string' ? req.body.refresh_token : null;
    if (!refreshToken) {
      return res.status(400).json({ detail: 'refresh_tokenが必要です' });
    }

    const decoded = jwt.verify(refreshToken, env.jwtSecret) as jwt.JwtPayload;
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ detail: '無効なトークンです' });
    }

    revokeRefreshToken(refreshToken);

    return res.status(204).send();
  } catch {
    return res.status(401).json({ detail: '無効なトークンです' });
  }
});

export default router;
