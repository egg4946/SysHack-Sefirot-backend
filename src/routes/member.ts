import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();

const parseId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

// ✨ 修正1: '/detail' に変更！
// (index.tsで '/api/v1/member' と合体して '/api/v1/member/detail' になります)
router.get('/detail', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const communityId = parseId(req.query.community_id);
    const targetUserId = parseId(req.query.user_id);
    const requesterId = req.user!.id;

    if (!communityId || !targetUserId) {
      return res.status(400).json({ detail: 'community_idとuser_idが必要です' });
    }

    // 自分がこのコミュニティのメンバーか確認
    const isRequesterMember = await prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: requesterId, communityId } }
    });
    if (!isRequesterMember) {
      return res.status(403).json({ detail: '閲覧権限がありません' });
    }

    // 対象ユーザーのコミュニティ情報を取得
    const targetMember = await prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: targetUserId, communityId } },
      include: { user: true }
    });

    if (!targetMember) {
      return res.status(404).json({ detail: '指定されたユーザーはこのプロジェクトにいません' });
    }

    // 対象ユーザーがこのプロジェクト内で担当している全タスクを取得
    const assignees = await prisma.taskAssignee.findMany({
      where: {
        userId: targetUserId,
        task: { communityId: communityId }
      },
      include: { task: true },
      orderBy: { task: { createdAt: 'desc' } }
    });

    // サマリー計算
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;

    const tasksData = assignees.map(a => {
      if (a.task.status === '完了') completed++;
      else if (a.task.status === '進行中') inProgress++;
      else notStarted++;

      return {
        task_id: a.task.id,
        // ✨ 修正2: データベースの 'title' を、フロントエンド用の 'name' に変換する！
        name: a.task.title,
        status: a.task.status,
        priority: a.task.priority,
        deadline: a.task.deadline ? a.task.deadline.toISOString() : null,
        personal_progress: a.progress,
        overall_progress: a.task.progress
      };
    });

    const payload = {
      user: {
        id: targetMember.user.id,
        // プロジェクト内表示名が未設定の場合のフォールバック
        display_name: targetMember.communityDisplayName || targetMember.user.displayName,
        joined_at: targetMember.user.createdAt.toISOString()
      },
      summary: {
        total_tasks: assignees.length,
        completed,
        in_progress: inProgress,
        not_started: notStarted
      },
      tasks: tasksData
    };

    return res.status(200).json(payload);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'メンバー詳細の取得中にエラーが発生しました' });
  }
});

export default router;
