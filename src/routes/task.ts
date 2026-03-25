import { Response, Router } from 'express';
import prisma from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();

type Priority = '大' | '中' | '小';
type TaskStatus = '未着手' | '進行中' | '完了';
type SortBy = 'created_at' | 'deadline' | 'priority' | 'progress';

const parseId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const parsePriority = (value: unknown): Priority | null => {
  if (value === '大' || value === '中' || value === '小') return value;
  return null;
};

const parseStatus = (value: unknown): TaskStatus | null => {
  if (value === '未着手' || value === '進行中' || value === '完了') return value;
  return null;
};

const parseDeadline = (value: unknown): Date | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const parseProgress = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value > 100) return null;
  return value;
};

const parseSortBy = (value: unknown): SortBy => {
  if (value === 'deadline' || value === 'priority' || value === 'progress') return value as SortBy;
  return 'created_at';
};

const parseOrder = (value: unknown): 'asc' | 'desc' => {
  if (value === 'desc') return 'desc';
  return 'asc';
};

const isCommunityMember = async (userId: string, communityId: string): Promise<boolean> => {
  const member = await prisma.communityMember.findUnique({
    where: { userId_communityId: { userId, communityId } },
  });
  return Boolean(member);
};

// --- TaskData ビルダー（個人進捗対応版！） ---
const buildTaskData = async (taskId: string) => {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      assignees: {
        include: { user: true } // ✨ TaskAssigneeテーブルからユーザー情報を引く
      },
      checklists: true,
      creator: true
    },
  });

  if (!task) return null;

  // 担当者の「プロジェクト内表示名」と「個人進捗度」をまとめる
  const formattedAssignees = await Promise.all(task.assignees.map(async (a) => {
    const member = await prisma.communityMember.findUnique({
      where: { userId_communityId: { userId: a.userId, communityId: task.communityId } }
    });
    return {
      id: a.user.id,
      email: a.user.email,
      display_name: member?.communityDisplayName || a.user.displayName,
      progress: a.progress, // ✨ その人の個人進捗度！
      created_at: a.createdAt.toISOString()
    };
  }));

  return {
    id: task.id,
    community_id: task.communityId,
    parent_task_id: task.parentId,
    name: task.title,
    description: task.description,
    progress: task.progress, // タスク全体の平均進捗度
    priority: task.priority,
    status: task.status,
    deadline: task.deadline ? task.deadline.toISOString() : null,
    created_by: task.createdBy,
    created_at: task.createdAt.toISOString(),
    assignees: formattedAssignees,
    checklists: task.checklists.map(c => ({
      id: c.id,
      task_id: c.taskId,
      content: c.content,
      is_completed: c.isCompleted
    }))
  };
};

// 1. タスク一覧取得 (ソート機能付き)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const communityId = parseId(req.query.community_id);
    const userId = req.user!.id;
    const sortBy = parseSortBy(req.query.sort_by);
    const order = parseOrder(req.query.order);

    if (!communityId) return res.status(400).json({ detail: 'community_idが必要です' });

    const member = await isCommunityMember(userId, communityId);
    if (!member) return res.status(403).json({ detail: 'このコミュニティを閲覧する権限がありません' });

    // 並び替えの条件を組み立てる
    const orderByParams: any = {};
    if (sortBy === 'created_at') orderByParams.createdAt = order;
    else if (sortBy === 'deadline') orderByParams.deadline = { sort: order, nulls: 'last' };
    else orderByParams[sortBy] = order;

    const tasks = await prisma.task.findMany({
      where: { communityId },
      orderBy: orderByParams,
      select: { id: true },
    });

    const payload = await Promise.all(tasks.map((task) => buildTaskData(task.id)));
    return res.status(200).json(payload.filter((task) => task !== null));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスクの取得中にエラーが発生しました' });
  }
});

// 2. タスク作成
router.post('/create', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;
    const communityId = parseId(req.body.community_id);
    const parentTaskId = req.body.parent_task_id === null ? null : parseId(req.body.parent_task_id);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : null;
    const priority = parsePriority(req.body.priority);
    const status = parseStatus(req.body.status) || undefined;
    const deadline = parseDeadline(req.body.deadline);

    if (!communityId || !name || !priority) {
      return res.status(400).json({ detail: 'community_id/name/priorityが不正です' });
    }

    const member = await isCommunityMember(userId, communityId);
    if (!member) return res.status(403).json({ detail: 'タスクを追加する権限がありません' });

    if (parentTaskId) {
      const parentTask = await prisma.task.findUnique({
        where: { id: parentTaskId },
        select: { communityId: true },
      });

      if (!parentTask) return res.status(404).json({ detail: 'parent_task_idのタスクが見つかりません' });
      if (parentTask.communityId !== communityId) return res.status(400).json({ detail: 'parent_task_idは同じcommunity_idのタスクを指定してください' });
    }

    const newTask = await prisma.task.create({
      data: {
        title: name,
        description,
        communityId,
        parentId: parentTaskId,
        createdBy: userId,
        priority,
        status,
        deadline,
      },
    });

    const taskData = await buildTaskData(newTask.id);
    return res.status(200).json(taskData);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスクの作成中にエラーが発生しました' });
  }
});

// 3. タスクの基本情報編集
router.patch('/update', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;
    const taskId = parseId(req.body.task_id);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : undefined;
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : (req.body.description === null ? null : undefined);
    const priority = parsePriority(req.body.priority);
    const deadline = req.body.deadline !== undefined ? parseDeadline(req.body.deadline) : undefined;

    if (!taskId) return res.status(400).json({ detail: 'task_idが不正です' });

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ detail: 'タスクが見つかりません' });

    const member = await isCommunityMember(userId, task.communityId);
    if (!member) return res.status(403).json({ detail: '編集権限がありません' });

    await prisma.task.update({
      where: { id: taskId },
      data: {
        title: name !== undefined && name !== '' ? name : undefined,
        description,
        priority: priority || undefined,
        deadline,
      },
    });

    const taskData = await buildTaskData(taskId);
    return res.status(200).json(taskData);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスクの更新中にエラーが発生しました' });
  }
});

// ✨ 4. 進捗更新 ＆ 個人進捗→タスク進捗→親タスク進捗の「全自動2段階計算」✨
router.patch('/progress', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;
    const taskId = parseId(req.body.task_id);
    const progress = parseProgress(req.body.progress);

    if (!taskId || progress === null) return res.status(400).json({ detail: 'task_id/progressが不正です' });

    const taskBeforeUpdate = await prisma.task.findUnique({ where: { id: taskId } });
    if (!taskBeforeUpdate) return res.status(404).json({ detail: 'タスクが見つかりません' });

    // 担当者テーブル(TaskAssignee)に自分がいるかチェック
    const assignee = await prisma.taskAssignee.findUnique({
      where: { taskId_userId: { taskId, userId } }
    });
    if (!assignee) return res.status(403).json({ detail: 'あなたはこのタスクの担当者ではありません' });

    // 1️⃣ 自分の「個人進捗」を更新する
    await prisma.taskAssignee.update({
      where: { id: assignee.id },
      data: { progress }
    });

    // 2️⃣ 同じタスクの全担当者の平均進捗を計算して、タスク自体の進捗にする
    const allAssignees = await prisma.taskAssignee.findMany({ where: { taskId } });
    const taskAvg = Math.floor(allAssignees.reduce((sum, a) => sum + a.progress, 0) / allAssignees.length);

    await prisma.task.update({
      where: { id: taskId },
      data: { progress: taskAvg }
    });

    // 3️⃣ もし親タスクがあれば、兄弟タスクの平均進捗を計算して、親タスクの進捗にする
    if (taskBeforeUpdate.parentId) {
      const siblingTasks = await prisma.task.findMany({
        where: { parentId: taskBeforeUpdate.parentId }
      });

      if (siblingTasks.length > 0) {
        const parentAvg = Math.floor(siblingTasks.reduce((sum, t) => sum + t.progress, 0) / siblingTasks.length);
        await prisma.task.update({
          where: { id: taskBeforeUpdate.parentId },
          data: { progress: parentAvg }
        });
      }
    }

    const taskData = await buildTaskData(taskId);
    return res.status(200).json(taskData);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスク進捗の更新中にエラーが発生しました' });
  }
});

// 5. ステータス更新
router.patch('/status', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;
    const taskId = parseId(req.body.task_id);
    const status = parseStatus(req.body.status);

    if (!taskId || !status) return res.status(400).json({ detail: 'task_id/statusが不正です' });

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ detail: 'タスクが見つかりません' });

    const member = await isCommunityMember(userId, task.communityId);
    if (!member) return res.status(403).json({ detail: '編集権限がありません' });

    await prisma.task.update({
      where: { id: taskId },
      data: { status },
    });

    const taskData = await buildTaskData(taskId);
    return res.status(200).json(taskData);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスク状態の更新中にエラーが発生しました' });
  }
});

// 6. 担当者アサイン (専用テーブルを使うように改修)
router.post('/assign', authenticateToken, async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const userId = req.user!.id;
    const taskId = parseId(req.body.task_id);
    const assigneeId = parseId(req.body.user_id);

    if (!taskId || !assigneeId) return res.status(400).json({ detail: 'task_id/user_idが不正です' });

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ detail: 'タスクが見つかりません' });

    const canEdit = await isCommunityMember(userId, task.communityId);
    const assigneeMember = await isCommunityMember(assigneeId, task.communityId);
    if (!canEdit || !assigneeMember) return res.status(403).json({ detail: '権限がないか、ユーザーがコミュニティにいません' });

    // すでにアサインされているかチェック
    const existing = await prisma.taskAssignee.findUnique({
      where: { taskId_userId: { taskId, userId: assigneeId } }
    });

    if (existing) {
      return res.status(200).json({ message: 'すでにアサインされています' });
    }

    // ✨ 新規: TaskAssigneeテーブルに登録
    await prisma.taskAssignee.create({
      data: {
        taskId: taskId,
        userId: assigneeId,
        progress: 0 // 初期進捗は0
      }
    });

    return res.status(200).json({ message: 'Assigned successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ detail: 'タスク担当者の更新中にエラーが発生しました' });
  }
});

export default router;
