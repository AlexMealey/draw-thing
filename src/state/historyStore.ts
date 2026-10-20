import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** What the UI needs to know about undo history; the history itself lives in the engine. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
}

export const historyStore = createStore<HistoryState>()(() => ({
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
}));

export function useHistory<T>(selector: (state: HistoryState) => T): T {
  return useStore(historyStore, selector);
}
