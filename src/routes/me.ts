import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();

// 自分の情報とコミュニティ一覧を取得 ( GET /api/v1/me )
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;

    // アカウント全体の大元のユーザー情報を取得
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ detail: 'ユーザーが見つかりません' });
    }

    // 自分が所属しているコミュニティの情報を取得（参加人数も一緒に！）
    const memberships = await prisma.communityMember.findMany({
      where: { userId },
      include: {
        community: {
          include: {
            _count: { select: { members: true } }
          }
        }
      },
      orderBy: { community: { createdAt: 'desc' } },
    });

    return res.status(200).json({
      user_data: {
        id: user.id,
        email: user.email,
        display_name: user.displayName, // 👈 アカウント全体での本名
        created_at: user.createdAt.toISOString(),
      },
      user_communities: memberships.map((m) => ({
        id: m.community.id,
        name: m.community.name,
        invite_code: m.community.inviteCode,
        member_count: m.community._count.members,
        created_at: m.community.createdAt.toISOString(),
        created_by: m.community.createdBy,
        // ✨ 新規追加: フロントエンドが「プロジェクトごとに設定した自分の名前」を表示できるようにする！
        community_display_name: m.communityDisplayName,
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'ユーザー情報の取得中にエラーが発生しました' });
  }
});

export default router;
