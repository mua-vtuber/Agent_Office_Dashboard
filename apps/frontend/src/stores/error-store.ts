import { create } from "zustand";

export type ErrorEntry = {
  id: string;
  title: string;
  message: string;
  ts: number;
};

type ErrorStore = {
  errors: ErrorEntry[];
  push: (title: string, message: string) => void;
  dismiss: (id: string) => void;
  clear: () => void;
};

let nextId = 1;

export const useErrorStore = create<ErrorStore>((set) => ({
  errors: [],
  push: (title, message) =>
    set((state) => ({
      errors: [
        ...state.errors,
        { id: String(nextId++), title, message, ts: Date.now() },
      ],
    })),
  dismiss: (id) =>
    set((state) => ({
      errors: state.errors.filter((e) => e.id !== id),
    })),
  clear: () => set({ errors: [] }),
}));
