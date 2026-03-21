import cors from 'cors';
import express, { Request, Response } from 'express';
import { env } from './config/env';

// 分割したルート（コンポーネント）をインポート
import authRoutes from './routes/auth';
import communityRoutes from './routes/community';
import taskRoutes from './routes/task';

const app = express();
const port = env.port;

const corsAllowedOrigins = new Set(env.corsOrigins);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsAllowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());

// 動作確認用のルート
app.get('/', (req: Request, res: Response) => {
  res.send('Sefirot Backend is running perfectly! 🚀');
});
app.get('/api/v1', (req: Request, res: Response) => {
  res.json({ message: 'Sefirot Backend API v1 🚀' });
});

// === 🚀 ルーティングの登録 ===
// 「/api/v1/auth」から始まる通信は、すべて authRoutes (routes/auth.ts) に任せる！
app.use('/api/v1/auth', authRoutes);

// 「/api/v1/community」から始まる通信は、すべて communityRoutes に任せる！
app.use('/api/v1/community', communityRoutes);

// 「/api/v1/task」から始まる通信は、すべて taskRoutes に任せる！
app.use('/api/v1/task', taskRoutes);

// サーバー起動
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
