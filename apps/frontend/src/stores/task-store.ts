import { create } from "zustand";

export type TaskView = {
  task_id: string;
  agent_id: string;
  status: "active" | "completed" | "failed";
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  last_event_ts: string;
};

type TaskStore = {
  tasks: Record<string, TaskView>;
  upsert: (task: TaskView) => void;
  setMany: (tasks: TaskView[]) => void;
};

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: {},
  upsert: (task) =>
    set((state) => ({
      tasks: {
        ...state.tasks,
        [task.task_id]: task,
      },
    })),
  setMany: (tasks) =>
    set(() => ({
      tasks: Object.fromEntries(tasks.map((t) => [t.task_id, t])),
    })),
}));
