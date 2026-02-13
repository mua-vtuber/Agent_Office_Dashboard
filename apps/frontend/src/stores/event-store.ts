import { create } from "zustand";

type EventStore = {
  events: unknown[];
  add: (event: unknown) => void;
  setAll: (events: unknown[]) => void;
};

export const useEventStore = create<EventStore>((set) => ({
  events: [],
  add: (event) =>
    set((state) => ({ events: [event, ...state.events].slice(0, 500) })),
  setAll: (events) => set({ events })
}));
