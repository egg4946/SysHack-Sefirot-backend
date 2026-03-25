import cors from 'cors';
import express, { Request, Response } from 'express';
import { env } from './config/env';

// 分割したルート（コンポーネント）をインポート
import authRoutes from './routes/auth';
import chatRouter from './routes/chat';
import checklistRoutes from './routes/checklist';
import communityRoutes from './routes/community';
import meRoutes from './routes/me';
import memberRouter from './routes/member';
import taskRoutes from './routes/task';

const app = express();
const port = env.port;

const corsAllowedOrigins = new Set(env.corsOrigins);

app.use(cors({
  origin: (origin, callback) => {
    // APIテストツール(!origin)、許可リスト、または「localhostからの通信」ならすべて許可する！
    if (!origin || corsAllowedOrigins.has(origin) || origin.startsWith('http://localhost:')) {
      return callback(null, true);
    }
    // 弾いた場合はターミナルにどのURLから来たかログを出す
    console.warn(`🚨 CORSブロック: ${origin}`);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// 監視カメラ：リクエストが来るたびにターミナルに表示する
app.use((req, res, next) => {
  console.log(`📥 リクエスト受信: [${req.method}] ${req.url}`);
  console.log(`📦 送られてきたデータ:`, req.body);
  next();
});

app.use(express.json()); // JSONのリクエストボディをパースするミドルウェア

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

// 「/api/v1/tasks」から始まる通信は、すべて taskRoutes に任せる！
app.use('/api/v1/tasks', taskRoutes);

// 「/api/v1/checklists」から始まる通信は、すべて checklistRoutes に任せる！
app.use('/api/v1/checklists', checklistRoutes);

// 「/api/v1」から始まる通信のうち、/me は meRoutes に任せる！
app.use('/api/v1', meRoutes);

// 「/api/v1」から始まる通信のうち、/member は memberRouter に任せる！
app.use('/api/v1/community', memberRouter);

// 「/api/v1/chat」から始まる通信は、すべて chatRouter に任せる！
app.use('/api/v1/chat', chatRouter);

// サーバー起動
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
