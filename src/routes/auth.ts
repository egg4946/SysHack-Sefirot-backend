import bcrypt from 'bcrypt';
import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import prisma from '../lib/prisma';
import { createRateLimit } from '../middlewares/rateLimit';


const router = Router();
const signupRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 20 });
const signinRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 10 });

const sanitizeEmail = (email: unknown): string | null => {
  if (typeof email !== 'string') {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const isStrongPassword = (password: unknown): password is string => {
  return typeof password === 'string' && password.length >= 8;
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

// 新規登録 ( /api/v1/auth/signup として後で登録されます )
router.post('/signup', signupRateLimit, async (req: Request, res: Response): Promise<any> => {
  try {
    const email = sanitizeEmail(req.body.email);
    const password = req.body.password;
    const displayName = sanitizeDisplayName(req.body.displayName);

    if (!email || !displayName || !isStrongPassword(password)) {
      return res.status(400).json({
        detail: '入力が不正です。email/displayName/passwordを確認してください',
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

    const token = jwt.sign({ sub: newUser.id }, env.jwtSecret, { expiresIn: '1h' });

    const { hashedPassword: _, ...userWithoutPassword } = newUser;
    return res.status(200).json({ user: userWithoutPassword, access_token: token });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'サーバーエラーが発生しました' });
  }
});

// ログイン ( /api/v1/auth/signin として後で登録されます )
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

    const token = jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: '1h' });

    const { hashedPassword: _, ...userWithoutPassword } = user;
    return res.status(200).json({ user: userWithoutPassword, access_token: token });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'サーバーエラーが発生しました' });
  }
});

export default router;
