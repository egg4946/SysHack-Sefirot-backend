import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();

router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ detail: 'ユーザーが見つかりません' });
    }

    const memberships = await prisma.communityMember.findMany({
      where: { userId },
      include: { community: true },
      orderBy: { community: { createdAt: 'desc' } },
    });

    return res.status(200).json({
      user_data: {
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        created_at: user.createdAt,
      },
      user_communities: memberships.map((m) => ({
        id: m.community.id,
        name: m.community.name,
        created_at: m.community.createdAt,
        created_by: m.community.createdBy,
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'ユーザー情報の取得中にエラーが発生しました' });
  }
});

export default router;
