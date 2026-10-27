import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** What the UI needs to know about the canvas view; the view itself lives in the engine. */
export interface ViewState {
  /** Degrees in (−180, 180], positive clockwise, rounded to 0.1°. */
  rotation: number;
}

export const viewStore = createStore<ViewState>()(() => ({ rotation: 0 }));

export function useView<T>(selector: (state: ViewState) => T): T {
  return useStore(viewStore, selector);
}
