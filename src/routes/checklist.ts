import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();

const parseId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const formatChecklist = (checklist: { id: string; taskId: string; content: string; isCompleted: boolean }) => ({
  id: checklist.id,
  task_id: checklist.taskId,
  content: checklist.content,
  is_completed: checklist.isCompleted,
});

const isCommunityMember = async (userId: string, communityId: string): Promise<boolean> => {
  const member = await prisma.communityMember.findUnique({
    where: { userId_communityId: { userId, communityId } },
  });
  return Boolean(member);
};

// 1. チェックリストの作成 ( POST /api/v1/checklists/create )
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

    if (!task) return res.status(404).json({ detail: 'タスクが見つかりません' });

    const member = await isCommunityMember(userId, task.communityId);
    if (!member) return res.status(403).json({ detail: '編集権限がありません' });

    // ✨ データベース（Prisma）に保存 ✨
    const newChecklist = await prisma.checklist.create({
      data: {
        taskId,
        content,
        isCompleted: false,
      },
    });

    return res.status(200).json(formatChecklist(newChecklist));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'チェックリスト作成中にエラーが発生しました' });
  }
});

// 2. チェックリストの更新 ( PATCH /api/v1/checklists/update )
router.patch('/update', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;
    const checklistId = parseId(req.body.checklist_id);
    const isCompleted = req.body.is_completed;

    if (!checklistId || typeof isCompleted !== 'boolean') {
      return res.status(400).json({ detail: 'checklist_id/is_completedが不正です' });
    }

    // 更新対象のチェックリストと、親タスクのcommunityIdを一緒に取得
    const checklist = await prisma.checklist.findUnique({
      where: { id: checklistId },
      include: { task: { select: { communityId: true } } },
    });

    if (!checklist) return res.status(404).json({ detail: 'チェックリストが見つかりません' });

    const member = await isCommunityMember(userId, checklist.task.communityId);
    if (!member) return res.status(403).json({ detail: '編集権限がありません' });

    // ✨ データベース（Prisma）を更新 ✨
    const updated = await prisma.checklist.update({
      where: { id: checklistId },
      data: { isCompleted },
    });

    return res.status(200).json(formatChecklist(updated));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'チェックリスト更新中にエラーが発生しました' });
  }
});

export default router;
