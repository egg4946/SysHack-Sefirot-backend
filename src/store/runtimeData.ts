type Priority = '大' | '中' | '小';

export type ChecklistItem = {
  id: string;
  taskId: string;
  content: string;
  isCompleted: boolean;
};

const taskPriority = new Map<string, Priority>();
const checklistItems = new Map<string, ChecklistItem>();

export const getTaskPriority = (taskId: string): Priority => {
  return taskPriority.get(taskId) ?? '中';
};

export const setTaskPriority = (taskId: string, priority: Priority): void => {
  taskPriority.set(taskId, priority);
};

export const addChecklistItem = (item: ChecklistItem): ChecklistItem => {
  checklistItems.set(item.id, item);
  return item;
};

export const updateChecklistItem = (id: string, isCompleted: boolean): ChecklistItem | null => {
  const current = checklistItems.get(id);
  if (!current) {
    return null;
  }

  const updated: ChecklistItem = { ...current, isCompleted };
  checklistItems.set(id, updated);
  return updated;
};

export const getTaskChecklistItems = (taskId: string): ChecklistItem[] => {
  const result: ChecklistItem[] = [];
  for (const item of checklistItems.values()) {
    if (item.taskId === taskId) {
      result.push(item);
    }
  }
  return result;
};
