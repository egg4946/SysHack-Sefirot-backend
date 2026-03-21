import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();

const sanitizeId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const sanitizeOptionalId = (value: unknown): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  return sanitizeId(value);
};

const sanitizeTitle = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 120) {
    return null;
  }
  return normalized;
};

const sanitizeDescription = (value: unknown): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length <= 2000 ? normalized : undefined;
};

const sanitizeProgress = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }
  if (value < 0 || value > 100) {
    return undefined;
  }
  return value;
};

const sanitizeDueDate = (value: unknown): Date | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
};

const isCommunityMember = async (userId: string, communityId: string): Promise<boolean> => {
  const member = await prisma.communityMember.findUnique({
    where: { userId_communityId: { userId, communityId } },
  });
  return Boolean(member);
};

// 1. タスクの作成 (POST /api/v1/task)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const title = sanitizeTitle(req.body.title);
    const description = sanitizeDescription(req.body.description);
    const parentId = sanitizeOptionalId(req.body.parentId);
    const communityId = sanitizeId(req.body.communityId);
    const assignedTo = sanitizeOptionalId(req.body.assignedTo);
    const dueDate = sanitizeDueDate(req.body.dueDate);
    const userId = req.user!.id;

    if (!title || !communityId || (req.body.description !== undefined && description === undefined) || (req.body.dueDate !== undefined && dueDate === undefined)) {
    return res.status(400).json({ detail: '入力が不正です。title/communityId/description/dueDateを確認してください' });
    }

    if (parentId === undefined || assignedTo === undefined) {
      return res.status(400).json({ detail: '入力が不正です。parentId/assignedToを確認してください' });
    }

    // セキュリティチェック：ユーザーがそのコミュニティのメンバーか確認
    const member = await isCommunityMember(userId, communityId);
    if (!member) {
      return res.status(403).json({ detail: 'このコミュニティにタスクを追加する権限がありません' });
    }

    if (assignedTo) {
      const assigneeMember = await isCommunityMember(assignedTo, communityId);
      if (!assigneeMember) {
        return res.status(400).json({ detail: 'assignedToは同じコミュニティのユーザーを指定してください' });
      }
    }

    if (parentId) {
      const parentTask = await prisma.task.findUnique({
        where: { id: parentId },
        select: { communityId: true },
      });

      if (!parentTask || parentTask.communityId !== communityId) {
        return res.status(400).json({ detail: 'parentIdが不正です。同じコミュニティ内のタスクを指定してください' });
      }
    }

    const newTask = await prisma.task.create({
      data: {
        title,
        description,
        parentId, // ← ここに親タスクのIDを入れると「子タスク」になる！空なら「親タスク」
        communityId,
        assignedTo,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
      // フロントエンドで表示しやすいように、担当者の名前も一緒に取得して返す
      include: { assignee: { select: { displayName: true } } }
    });

    return res.status(200).json(newTask);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスクの作成中にエラーが発生しました' });
  }
});

// 2. 特定のコミュニティのタスク一覧を取得 (GET /api/v1/task/community/:communityId)
router.get('/community/:communityId', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const communityId = sanitizeId(Array.isArray(req.params.communityId) ? req.params.communityId[0] : req.params.communityId);
    const userId = req.user!.id;

    if (!communityId) {
      return res.status(400).json({ detail: 'communityIdが不正です' });
    }

    // 権限チェック
    const member = await isCommunityMember(userId, communityId);
    if (!member) {
      return res.status(403).json({ detail: 'このコミュニティを閲覧する権限がありません' });
    }

    // コミュニティ内の全タスクを取得（担当者名もセットで）
    const tasks = await prisma.task.findMany({
      where: { communityId },
      include: { assignee: { select: { displayName: true, email: true } } },
      orderBy: { createdAt: 'asc' }
    });

    return res.status(200).json(tasks);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスクの取得中にエラーが発生しました' });
  }
});

// 3. タスクの更新・進捗変更 (PATCH /api/v1/task/:id)
router.patch('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = sanitizeId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const userId = req.user!.id;
    // 更新したいデータだけを受け取る（例: { progress: 80 } など）
    const title = req.body.title === undefined ? undefined : sanitizeTitle(req.body.title);
    const description = sanitizeDescription(req.body.description);
    const progress = sanitizeProgress(req.body.progress);
    const assignedTo = sanitizeOptionalId(req.body.assignedTo);
    const dueDate = sanitizeDueDate(req.body.dueDate);

    if (!id) {
      return res.status(400).json({ detail: 'idが不正です' });
    }

    if (
    (req.body.title !== undefined && !title) ||
    (req.body.description !== undefined && description === undefined) ||
    (req.body.dueDate !== undefined && dueDate === undefined) ||
    (req.body.assignedTo !== undefined && assignedTo === undefined)
    ) {
      return res.status(400).json({ detail: '更新データが不正です' });
    }

    if (req.body.progress !== undefined && progress === undefined) {
      return res.status(400).json({ detail: 'progressは0-100の整数で指定してください' });
    }

    // タスクが存在するか＆コミュニティIDを取得
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ detail: 'タスクが見つかりません' });

    // 権限チェック
    const member = await isCommunityMember(userId, task.communityId);
    if (!member) return res.status(403).json({ detail: '編集権限がありません' });

    if (assignedTo) {
      const assigneeMember = await isCommunityMember(assignedTo, task.communityId);
      if (!assigneeMember) {
        return res.status(400).json({ detail: 'assignedToは同じコミュニティのユーザーを指定してください' });
      }
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        title: title ?? undefined,
        description,
        progress, // フロントエンドの進捗スライダーを動かした時にここが更新される
        assignedTo,
        dueDate: dueDate ? new Date(dueDate) : undefined,
      },
      include: { assignee: { select: { displayName: true } } }
    });

    return res.status(200).json(updatedTask);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスクの更新中にエラーが発生しました' });
  }
});

// 4. タスクの削除 (DELETE /api/v1/task/:id)
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = sanitizeId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
    const userId = req.user!.id;

    if (!id) {
      return res.status(400).json({ detail: 'idが不正です' });
    }

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ detail: 'タスクが見つかりません' });

    const member = await isCommunityMember(userId, task.communityId);
    if (!member) return res.status(403).json({ detail: '削除権限がありません' });

    await prisma.task.delete({ where: { id } });

    return res.status(200).json({ message: 'タスクを削除しました' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスクの削除中にエラーが発生しました' });
  }
});

export default router;
