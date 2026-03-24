import { randomUUID } from 'crypto';
import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';
import { addChecklistItem, updateChecklistItem } from '../store/runtimeData';

const router = Router();

const parseId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const isCommunityMember = async (userId: string, communityId: string): Promise<boolean> => {
  const member = await prisma.communityMember.findUnique({
    where: { userId_communityId: { userId, communityId } },
  });
  return Boolean(member);
};

router.post('/create', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;
    const taskId = parseId(req.body.task_id);
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

    if (!taskId || !content) {
      return res.status(400).json({ detail: 'task_id/contentが不正です' });
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { communityId: true },
    });

    if (!task) {
      return res.status(404).json({ detail: 'タスクが見つかりません' });
    }

    const member = await isCommunityMember(userId, task.communityId);
    if (!member) {
      return res.status(403).json({ detail: '編集権限がありません' });
    }

    const item = addChecklistItem({
      id: randomUUID(),
      taskId,
      content,
      isCompleted: false,
    });

    return res.status(200).json({
      id: item.id,
      task_id: item.taskId,
      content: item.content,
      is_completed: item.isCompleted,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'チェックリスト作成中にエラーが発生しました' });
  }
});

router.patch('/update', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  const checklistId = parseId(req.body.checklist_id);
  const isCompleted = req.body.is_completed;

  if (!checklistId || typeof isCompleted !== 'boolean') {
    return res.status(400).json({ detail: 'checklist_id/is_completedが不正です' });
  }

  const updated = updateChecklistItem(checklistId, isCompleted);
  if (!updated) {
    return res.status(404).json({ detail: 'チェックリストが見つかりません' });
  }

  return res.status(200).json({
    id: updated.id,
    task_id: updated.taskId,
    content: updated.content,
    is_completed: updated.isCompleted,
  });
});

export default router;
