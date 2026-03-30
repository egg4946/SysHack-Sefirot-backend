import cors from 'cors';
import express, { Request, Response } from 'express';
import expressWs from 'express-ws'; // ✨ WebSocketライブラリ

import { env } from './config/env';

// 各種ルーターのインポート
import authRoutes from './routes/auth';
import checklistRoutes from './routes/checklist';
import communityRoutes from './routes/community';
import meRoutes from './routes/me';
import memberRouter from './routes/member';
import taskRoutes from './routes/task';

// ✨ chatRouter に加えて、さきほど作った chatWsHandler も読み込む！
import chatRouter, { chatWsHandler } from './routes/chat';

// === アプリの初期化 ===
const app = express();
expressWs(app); // ✨ ここでExpressアプリ全体をWebSocket対応に強化！

const port = env.port;

app.use(cors({
  origin: env.corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.use((req, res, next) => {
  console.log(`📥 リクエスト受信: [${req.method}] ${req.path}`);
  next();
});

app.get('/', (req: Request, res: Response) => {
  res.send('Sefirot Backend is running perfectly! 🚀');
});
app.get('/api/v1', (req: Request, res: Response) => {
  res.json({ message: 'Sefirot Backend API v1 🚀' });
});

// === 🚀 通常のAPIルーティング ===
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/community', communityRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/checklists', checklistRoutes);
app.use('/api/v1', meRoutes);
app.use('/api/v1/member', memberRouter);
app.use('/api/v1/chat', chatRouter); // 過去のチャット履歴取得など

// === ✨ WebSocketのルーティング ===
// router ではなく、app 本体に直接 WebSocket の受け口を作る（これでエラー回避！）
(app as any).ws('/api/v1/chat/ws', chatWsHandler);

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
