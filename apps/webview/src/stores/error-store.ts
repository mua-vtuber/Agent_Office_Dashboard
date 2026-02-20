import { create } from 'zustand';

export interface AppErrorEntry {
  source: string;
  message: string;
  ts: string;
}

interface ErrorStoreState {
  errors: AppErrorEntry[];
  push: (entry: AppErrorEntry) => void;
  dismiss: (index: number) => void;
  clear: () => void;
}

export const useErrorStore = create<ErrorStoreState>((set) => ({
  errors: [],
  push: (entry) => set((state) => ({ errors: [...state.errors, entry] })),
  dismiss: (index) =>
    set((state) => ({ errors: state.errors.filter((_, i) => i !== index) })),
  clear: () => set({ errors: [] }),
}));
