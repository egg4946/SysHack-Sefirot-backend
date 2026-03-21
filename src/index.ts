import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
dotenv.config();

const app = express();
const port = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret_fallback';
const prisma = new PrismaClient(); // データベース操作用の魔法の杖

app.use(cors({
  origin: '*', // フロントエンドからの通信をすべて許可
  credentials: true
}));
app.use(express.json());

// --- 認証API (Auth) ---

// 1. 新規登録 (Signup)
app.post('/api/v1/auth/signup', async (req: Request, res: Response): Promise<any> => {
  console.log('キタ！！フロントからSignupのリクエストが来ました！データ:', req.body);
  try {
    const { email, password, displayName } = req.body;

    // 既に登録されているかチェック
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ detail: 'このメールアドレスは既に登録されています' });
    }

    // パスワードのハッシュ化（暗号化）
    const hashedPassword = await bcrypt.hash(password, 10);

    // Prismaを使ってデータベースにユーザーを保存！
    const newUser = await prisma.user.create({
      data: {
        email,
        hashedPassword,
        displayName,
      },
    });

    // ログイン用の通行証（JWTトークン）を発行
    const token = jwt.sign({ sub: newUser.id }, JWT_SECRET, { expiresIn: '1h' });

    // パスワード情報だけを取り除いてからフロントに返す
    const { hashedPassword: _, ...userWithoutPassword } = newUser;
    return res.status(200).json({ user: userWithoutPassword, access_token: token });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'サーバーエラーが発生しました' });
  }
});

// 2. ログイン (Signin)
app.post('/api/v1/auth/signin', async (req: Request, res: Response): Promise<any> => {
  console.log('キタ！！フロントからSigninのリクエストが来ました！データ:', req.body);
  try {
    const { email, password } = req.body;

    // メールアドレスでユーザーを探す
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ detail: 'メールアドレスまたはパスワードが間違っています' });
    }

    // パスワードの答え合わせ
    const isValidPassword = await bcrypt.compare(password, user.hashedPassword);
    if (!isValidPassword) {
      return res.status(401).json({ detail: 'メールアドレスまたはパスワードが間違っています' });
    }

    // 通行証（JWTトークン）を発行
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '1h' });

    const { hashedPassword: _, ...userWithoutPassword } = user;
    return res.status(200).json({ user: userWithoutPassword, access_token: token });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'サーバーエラーが発生しました' });
  }
});

// サーバーの起動
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
