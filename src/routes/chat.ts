import { Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();

const parseId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

// 1. メッセージ一覧取得 ( GET /api/v1/chat/messages?community_id=xxx )
router.get('/messages', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const communityId = parseId(req.query.community_id);
    const userId = req.user!.id;

    if (!communityId) return res.status(400).json({ detail: 'community_idが必要です' });

    // 自分がこのコミュニティのメンバーか確認
    const isMember = await prisma.communityMember.findUnique({
      where: { userId_communityId: { userId, communityId } }
    });

    if (!isMember) return res.status(403).json({ detail: '閲覧権限がありません' });

    // メッセージと送信者の基本情報を取得
    const messages = await prisma.chatMessage.findMany({
      where: { communityId },
      include: { user: true },
      orderBy: { createdAt: 'asc' } // 古い順（LINEのような上から下のタイムライン）
    });

    // プロジェクト内表示名を取得するために、メンバー一覧を取得
    const communityMembers = await prisma.communityMember.findMany({
      where: { communityId }
    });

    // ユーザーIDをキーにして「プロジェクト内表示名」を引けるように辞書化
    const displayNameMap = new Map(
      communityMembers.map(m => [m.userId, m.communityDisplayName])
    );

    const payload = messages.map(msg => ({
      id: msg.id,
      community_id: msg.communityId,
      user: {
        id: msg.user.id,
        // プロジェクト内表示名があればそれを、無ければアカウント名を使う
        display_name: displayNameMap.get(msg.userId) || msg.user.displayName
      },
      content: msg.content,
      image_url: msg.imageUrl, // 今回は使いませんが箱として返します
      created_at: msg.createdAt.toISOString()
    }));

    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'チャット履歴の取得中にエラーが発生しました' });
  }
});

// 2. メッセージ送信 ( POST /api/v1/chat/send )
router.post('/send', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const communityId = parseId(req.body.community_id);
    const userId = req.user!.id;
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    const imageUrl = typeof req.body.image_url === 'string' ? req.body.image_url.trim() : null;

    if (!communityId) return res.status(400).json({ detail: 'community_idが不正です' });
    if (!content && !imageUrl) return res.status(400).json({ detail: 'メッセージを入力してください' });

    // 自分がこのコミュニティのメンバーか確認しつつ、自分の表示名を取得
    const member = await prisma.communityMember.findUnique({
      where: { userId_communityId: { userId, communityId } },
      include: { user: true }
    });

    if (!member) return res.status(403).json({ detail: '送信権限がありません' });

    // データベースにメッセージを保存
    const newMessage = await prisma.chatMessage.create({
      data: {
        communityId,
        userId,
        content,
        imageUrl
      }
    });

    // フロントエンドに返すデータを作成（送信後すぐに画面に表示できるようにするため）
    const payload = {
      id: newMessage.id,
      community_id: newMessage.communityId,
      user: {
        id: member.user.id,
        display_name: member.communityDisplayName
      },
      content: newMessage.content,
      image_url: newMessage.imageUrl,
      created_at: newMessage.createdAt.toISOString()
    };

    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'メッセージの送信中にエラーが発生しました' });
  }
});

// ==========================================
// ✨ WebSocket リアルタイム通信の実装
// ==========================================

// 接続中のクライアントを管理するリスト
interface ChatClient {
  ws: any;
  communityId: string;
  userId: string;
}
const connectedClients = new Set<ChatClient>();

// 🚨 router.ws(...) ではなく、ただの関数として書き出します！
export const chatWsHandler = async (ws: any, req: any) => {
  const token = req.query.token as string;
  const communityId = req.query.community_id as string;

  if (!token || !communityId) {
    ws.close(1008, '認証トークンとコミュニティIDが必要です');
    return;
  }

  let userId: string;

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    if (typeof decoded.sub !== 'string') throw new Error();
    userId = decoded.sub;
  } catch (error) {
    ws.close(1008, '無効なトークンです');
    return;
  }

  const member = await prisma.communityMember.findUnique({
    where: { userId_communityId: { userId, communityId } },
    include: { user: true }
  });

  if (!member) {
    ws.close(1008, 'このプロジェクトのメンバーではありません');
    return;
  }

  const client: ChatClient = { ws, communityId, userId };
  connectedClients.add(client);
  console.log(`🔗 WS Connected: User ${userId} joined Community ${communityId}`);

  ws.on('message', async (msgStr: string) => {
    try {
      const data = JSON.parse(msgStr);
      if (!data.content) return;

      const newMessage = await prisma.chatMessage.create({
        data: {
          communityId,
          userId,
          content: data.content,
          imageUrl: null
        }
      });

      const payload = {
        id: newMessage.id,
        community_id: newMessage.communityId,
        user: {
          id: member.user.id,
          display_name: member.communityDisplayName || member.user.displayName
        },
        content: newMessage.content,
        image_url: newMessage.imageUrl,
        created_at: newMessage.createdAt.toISOString()
      };

      const payloadString = JSON.stringify(payload);

      connectedClients.forEach((connectedClient) => {
        if (connectedClient.communityId === communityId && connectedClient.ws.readyState === 1) {
          connectedClient.ws.send(payloadString);
        }
      });

    } catch (error) {
      console.error('WebSocketメッセージ処理エラー:', error);
    }
  });

  ws.on('close', () => {
    connectedClients.delete(client);
    console.log(`🔌 WS Disconnected: User ${userId}`);
  });
};

export default router;
