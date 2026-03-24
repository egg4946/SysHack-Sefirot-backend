import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth'; // ← 関所を呼び出し

const router = Router();

const generateInviteCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(randomInt(chars.length));
  }
  return result;
};

const sanitizeCommunityName = (name: unknown): string | null => {
  if (typeof name !== 'string') {
    return null;
  }

  const normalized = name.trim();
  if (normalized.length < 1 || normalized.length > 100) {
    return null;
  }

  return normalized;
};

const sanitizeInviteCode = (inviteCode: unknown): string | null => {
  if (typeof inviteCode !== 'string') {
    return null;
  }

  const normalized = inviteCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized)) {
    return null;
  }

  return normalized;
};

const formatCommunity = (community: { id: string; name: string; createdBy: string; createdAt: Date }) => {
  return {
    id: community.id,
    name: community.name,
    created_by: community.createdBy,
    created_at: community.createdAt,
  };
};

// コミュニティ作成 ( /api/v1/community/create になります )
router.post('/create', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const name = sanitizeCommunityName(req.body.name);
    const userId = req.user!.id;

    if (!name) {
      return res.status(400).json({ detail: 'nameは1-100文字の文字列で指定してください' });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const inviteCode = generateInviteCode();

      try {
        const newCommunity = await prisma.community.create({
          data: {
            name,
            inviteCode,
            createdBy: userId,
            members: {
              create: { userId: userId }
            }
          },
        });

        return res.status(200).json(formatCommunity(newCommunity));
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }

    return res.status(503).json({ detail: '招待コードの生成に失敗しました。再試行してください' });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'コミュニティ作成中にエラーが発生しました' });
  }
});

// コミュニティ参加 ( /api/v1/community/join になります )
router.post('/join', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const inviteCode = sanitizeInviteCode(req.body.invite_code ?? req.body.invite_Code);
    const userId = req.user!.id;

    if (!inviteCode) {
      return res.status(400).json({ detail: 'invite_codeは6文字の英数字で指定してください' });
    }

    const community = await prisma.community.findUnique({
      where: { inviteCode }
    });

    if (!community) {
      return res.status(404).json({ detail: '招待コードが無効です' });
    }

    const existingMember = await prisma.communityMember.findUnique({
      where: {
        userId_communityId: { userId: userId, communityId: community.id }
      }
    });

    if (existingMember) {
      return res.status(200).json(formatCommunity(community));
    }

    await prisma.communityMember.create({
      data: { userId: userId, communityId: community.id }
    });

    return res.status(200).json(formatCommunity(community));

  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'コミュニティ参加中にエラーが発生しました' });
  }
});

// 3. 参加中のコミュニティ一覧取得 ( /api/v1/community/list )
router.get('/list', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;

    // 自分が所属しているコミュニティを検索し、同時に「参加人数」もカウントして取得する！
    const memberships = await prisma.communityMember.findMany({
      where: { userId: userId },
      include: {
        community: {
          include: {
            _count: {
              select: { members: true } // ここが参加人数の自動計算の魔法
            }
          }
        }
      },
      orderBy: {
        community: { createdAt: 'desc' } // 新しい順に並べる
      }
    });

    // フロントエンドの仕様書（カード表示）に合わせて、データを綺麗な形に整形して返す
    const communities = memberships.map(m => ({
      id: m.community.id,
      name: m.community.name,
      invite_code: m.community.inviteCode,
      created_by: m.community.createdBy,
      created_at: m.community.createdAt,
      member_count: m.community._count.members // 参加人数！
    }));

    return res.status(200).json(communities);

  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'コミュニティ一覧の取得中にエラーが発生しました' });
  }
});

router.post('/invite', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const communityId = typeof req.body.community_id === 'string' ? req.body.community_id.trim() : '';
    const limitRaw = req.body.limit;
    const userId = req.user!.id;

    if (!communityId) {
      return res.status(400).json({ detail: 'community_idが必要です' });
    }

    const member = await prisma.communityMember.findUnique({
      where: { userId_communityId: { userId, communityId } },
    });

    if (!member) {
      return res.status(403).json({ detail: 'このコミュニティへの招待コード発行権限がありません' });
    }

    const community = await prisma.community.findUnique({ where: { id: communityId } });
    if (!community) {
      return res.status(404).json({ detail: 'コミュニティが見つかりません' });
    }

    const parsedLimit = typeof limitRaw === 'string' && !Number.isNaN(new Date(limitRaw).getTime())
      ? new Date(limitRaw)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    return res.status(200).json({ invite_code: community.inviteCode, limit: parsedLimit.toISOString() });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: '招待コード発行中にエラーが発生しました' });
  }
});

export default router;
