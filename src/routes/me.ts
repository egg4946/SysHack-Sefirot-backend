import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();

// 自分の情報とコミュニティ一覧を取得 ( GET /api/v1/me )
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ detail: 'ユーザーが見つかりません' });
    }

    // ✨ 修正: _count で参加人数を計算して取得！ ✨
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
        display_name: user.displayName,
        created_at: user.createdAt.toISOString(),
      },
      user_communities: memberships.map((m) => ({
        id: m.community.id,
        name: m.community.name,
        invite_code: m.community.inviteCode, // 👈 復活！
        member_count: m.community._count.members, // 👈 復活！
        created_at: m.community.createdAt.toISOString(),
        created_by: m.community.createdBy,
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'ユーザー情報の取得中にエラーが発生しました' });
  }
});

export default router;
