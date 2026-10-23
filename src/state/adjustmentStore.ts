import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AdjustmentKind } from '../engine/filters/Filters';

/** The adjustment being previewed on the active layer, if any (the engine owns it). */
export interface AdjustmentState {
  kind: AdjustmentKind | null;
}

export const adjustmentStore = createStore<AdjustmentState>()(() => ({ kind: null }));

export function useAdjustment<T>(selector: (state: AdjustmentState) => T): T {
  return useStore(adjustmentStore, selector);
}
