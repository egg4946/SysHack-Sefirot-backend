import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();

// --- ユーティリティ関数 ---
const generateInviteCode = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(randomInt(chars.length));
  }
  return result;
};

const sanitizeCommunityName = (name: unknown): string | null => {
  if (typeof name !== 'string') return null;
  const normalized = name.trim();
  if (normalized.length < 1 || normalized.length > 100) return null;
  return normalized;
};

const sanitizeInviteCode = (inviteCode: unknown): string | null => {
  if (typeof inviteCode !== 'string') return null;
  const normalized = inviteCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized)) return null;
  return normalized;
};

const parseId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const formatCommunity = (community: any) => {
  return {
    id: community.id,
    name: community.name,
    invite_code: community.inviteCode, // 👈 追加
    member_count: community._count?.members || 1, // 👈 追加（作成直後は1人）
    created_by: community.createdBy,
    created_at: community.createdAt.toISOString(),
  };
};

// 1. コミュニティ作成 ( POST /api/v1/community/create )
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

// 2. コミュニティ参加 ( POST /api/v1/community/join )
router.post('/join', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const inviteCode = sanitizeInviteCode(req.body.invite_code);
    const userId = req.user!.id;

    if (!inviteCode) {
      return res.status(400).json({ detail: 'invite_codeは6文字の英数字で指定してください' });
    }

    const community = await prisma.community.findUnique({
      where: { inviteCode },
      include: {
        _count: { select: { members: true } }
      }
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

    if (community._count) {
      community._count.members += 1;
    } else {community._count = { members: 2 };
    }

    return res.status(200).json(formatCommunity(community));

  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'コミュニティ参加中にエラーが発生しました' });
  }
});

// 3. 招待コードの発行 ( POST /api/v1/community/invite )
router.post('/invite', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const communityId = parseId(req.body.community_id);
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

// 4. 【新規】メンバー一覧取得 ( GET /api/v1/community/members?community_id=xxx )
router.get('/members', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const communityId = parseId(req.query.community_id);
    const userId = req.user!.id;

    if (!communityId) {
      return res.status(400).json({ detail: 'community_idが必要です' });
    }

    // 自分がそのコミュニティに所属しているかチェック
    const isMember = await prisma.communityMember.findUnique({
      where: { userId_communityId: { userId, communityId } }
    });

    if (!isMember) {
      return res.status(403).json({ detail: 'このコミュニティのメンバー情報を閲覧する権限がありません' });
    }

    // コミュニティの全メンバーを取得して、Userスキーマの形に整形
    const members = await prisma.communityMember.findMany({
      where: { communityId },
      include: { user: true },
      orderBy: { user: { createdAt: 'asc' } }
    });

    const formattedMembers = members.map(m => ({
      id: m.user.id,
      email: m.user.email,
      display_name: m.user.displayName,
      created_at: m.user.createdAt.toISOString()
    }));

    return res.status(200).json(formattedMembers);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'メンバー一覧の取得中にエラーが発生しました' });
  }
});

// 5. 【新規】メンバーのキック ( POST /api/v1/community/kick )
router.post('/kick', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const communityId = parseId(req.body.community_id);
    const targetUserId = parseId(req.body.user_id);
    const requesterId = req.user!.id;

    if (!communityId || !targetUserId) {
      return res.status(400).json({ detail: 'community_idとuser_idが必要です' });
    }

    // キック権限の確認（コミュニティ作成者のみキック可能とする）
    const community = await prisma.community.findUnique({
      where: { id: communityId }
    });

    if (!community) {
      return res.status(404).json({ detail: 'コミュニティが見つかりません' });
    }

    if (community.createdBy !== requesterId) {
      return res.status(403).json({ detail: 'メンバーをキックする権限がありません（作成者のみ可能です）' });
    }

    // 自分自身をキックしようとしていないかチェック
    if (requesterId === targetUserId) {
      return res.status(400).json({ detail: '作成者自身をキックすることはできません' });
    }

    // メンバーが存在するか確認して削除
    const targetMember = await prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: targetUserId, communityId } }
    });

    if (!targetMember) {
      return res.status(404).json({ detail: '指定されたユーザーはこのコミュニティのメンバーではありません' });
    }

    await prisma.communityMember.delete({
      where: { userId_communityId: { userId: targetUserId, communityId } }
    });

    return res.status(200).json({ message: 'メンバーをキックしました' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'キック処理中にエラーが発生しました' });
  }
});

export default router;
