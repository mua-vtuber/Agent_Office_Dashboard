import { create } from "zustand";

type Language = "ko" | "en";
type MotionLevel = "low" | "normal" | "high";

type UiSettingsState = {
  language: Language;
  motion: MotionLevel;
  setAll: (next: { language: Language; motion: MotionLevel }) => void;
  setLanguage: (language: Language) => void;
  setMotion: (motion: MotionLevel) => void;
};

const STORAGE_KEY = "aod.ui.settings.v1";

function loadInitial(): { language: Language; motion: MotionLevel } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { language: "ko", motion: "normal" };
    const parsed = JSON.parse(raw) as { language?: Language; motion?: MotionLevel };
    return {
      language: parsed.language === "en" ? "en" : "ko",
      motion: parsed.motion === "low" || parsed.motion === "high" ? parsed.motion : "normal"
    };
  } catch {
    return { language: "ko", motion: "normal" };
  }
}

function save(next: { language: Language; motion: MotionLevel }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures in MVP
  }
}

const initial = loadInitial();

export const useUiSettingsStore = create<UiSettingsState>((set, get) => ({
  language: initial.language,
  motion: initial.motion,
  setAll: (next) => {
    set({ language: next.language, motion: next.motion });
    save(next);
  },
  setLanguage: (language) => {
    set({ language });
    const state = get();
    save({ language: state.language, motion: state.motion });
  },
  setMotion: (motion) => {
    set({ motion });
    const state = get();
    save({ language: state.language, motion: state.motion });
  }
}));
