import { create } from 'zustand';
import type { DisplayConfig } from '../types/ipc';

interface UiStoreState {
  showResumeModal: boolean;
  displayConfig: DisplayConfig | null;
  setShowResumeModal: (show: boolean) => void;
  setDisplayConfig: (config: DisplayConfig) => void;
}

export const useUiStore = create<UiStoreState>((set) => ({
  showResumeModal: false,
  displayConfig: null,
  setShowResumeModal: (show) => set({ showResumeModal: show }),
  setDisplayConfig: (config) => set({ displayConfig: config }),
}));
