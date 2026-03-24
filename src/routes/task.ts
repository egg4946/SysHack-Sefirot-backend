import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';
import { getTaskChecklistItems, getTaskPriority, setTaskPriority } from '../store/runtimeData';

const router = Router();

type Priority = '大' | '中' | '小';

const parseId = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const parsePriority = (value: unknown): Priority | null => {
  if (value === '大' || value === '中' || value === '小') {
    return value;
  }
  return null;
};

const parseDeadline = (value: unknown): Date | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const parseProgress = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  if (value < 0 || value > 100) {
    return null;
  }
  return value;
};

const isCommunityMember = async (userId: string, communityId: string): Promise<boolean> => {
  const member = await prisma.communityMember.findUnique({
    where: { userId_communityId: { userId, communityId } },
  });
  return Boolean(member);
};

const buildUser = (user: { id: string; email: string; displayName: string; createdAt: Date }) => ({
  id: user.id,
  email: user.email,
  display_name: user.displayName,
  created_at: user.createdAt,
});

const buildTaskData = async (taskId: string) => {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignee: true,
      community: true,
    },
  });

  if (!task) {
    return null;
  }

  const assignees = task.assignee ? [buildUser(task.assignee)] : [];
  const checklists = getTaskChecklistItems(task.id).map((item) => ({
    id: item.id,
    task_id: item.taskId,
    content: item.content,
    is_completed: item.isCompleted,
  }));

  return {
    id: task.id,
    community_id: task.communityId,
    parent_task_id: task.parentId,
    name: task.title,
    progress: task.progress,
    priority: getTaskPriority(task.id),
    deadline: task.dueDate,
    created_by: task.community.createdBy,
    created_at: task.createdAt,
    assignees,
    checklists,
  };
};

router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const communityId = parseId(req.query.community_id);
    const userId = req.user!.id;

    if (!communityId) {
      return res.status(400).json({ detail: 'community_idが必要です' });
    }

    const member = await isCommunityMember(userId, communityId);
    if (!member) {
      return res.status(403).json({ detail: 'このコミュニティを閲覧する権限がありません' });
    }

    const tasks = await prisma.task.findMany({
      where: { communityId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    const payload = await Promise.all(tasks.map((task) => buildTaskData(task.id)));
    return res.status(200).json(payload.filter((task) => task !== null));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスクの取得中にエラーが発生しました' });
  }
});

router.post('/create', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;
    const communityId = parseId(req.body.community_id);
    const parentTaskId = req.body.parent_task_id === null ? null : parseId(req.body.parent_task_id);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const priority = parsePriority(req.body.priority);
    const deadline = parseDeadline(req.body.deadline);

    if (!communityId || !name || !priority) {
      return res.status(400).json({ detail: 'community_id/name/priorityが不正です' });
    }

    if (req.body.parent_task_id !== undefined && req.body.parent_task_id !== null && !parentTaskId) {
      return res.status(400).json({ detail: 'parent_task_idが不正です' });
    }

    if (req.body.deadline !== undefined && req.body.deadline !== null && !deadline) {
      return res.status(400).json({ detail: 'deadlineが不正です' });
    }

    const member = await isCommunityMember(userId, communityId);
    if (!member) {
      return res.status(403).json({ detail: 'このコミュニティにタスクを追加する権限がありません' });
    }

    if (parentTaskId) {
      const parentTask = await prisma.task.findUnique({
        where: { id: parentTaskId },
        select: { communityId: true },
      });
      if (!parentTask || parentTask.communityId !== communityId) {
        return res.status(400).json({ detail: 'parent_task_idが不正です' });
      }
    }

    const newTask = await prisma.task.create({
      data: {
        title: name,
        description: null,
        communityId,
        parentId: parentTaskId,
        dueDate: deadline,
      },
      select: { id: true },
    });

    setTaskPriority(newTask.id, priority);

    const taskData = await buildTaskData(newTask.id);
    return res.status(200).json(taskData);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスクの作成中にエラーが発生しました' });
  }
});

router.patch('/progress', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;
    const taskId = parseId(req.body.task_id);
    const progress = parseProgress(req.body.progress);

    if (!taskId || progress === null) {
      return res.status(400).json({ detail: 'task_id/progressが不正です' });
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

    await prisma.task.update({
      where: { id: taskId },
      data: { progress },
    });

    const taskData = await buildTaskData(taskId);
    return res.status(200).json(taskData);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスク進捗の更新中にエラーが発生しました' });
  }
});

router.post('/assign', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;
    const taskId = parseId(req.body.task_id);
    const assigneeId = parseId(req.body.user_id);

    if (!taskId || !assigneeId) {
      return res.status(400).json({ detail: 'task_id/user_idが不正です' });
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { communityId: true },
    });

    if (!task) {
      return res.status(404).json({ detail: 'タスクが見つかりません' });
    }

    const canEdit = await isCommunityMember(userId, task.communityId);
    if (!canEdit) {
      return res.status(403).json({ detail: '編集権限がありません' });
    }

    const assigneeMember = await isCommunityMember(assigneeId, task.communityId);
    if (!assigneeMember) {
      return res.status(400).json({ detail: 'user_idは同じコミュニティのユーザーを指定してください' });
    }

    await prisma.task.update({
      where: { id: taskId },
      data: { assignedTo: assigneeId },
    });

    return res.status(200).json({ message: 'Assigned successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスク担当者の更新中にエラーが発生しました' });
  }
});

export default router;
