import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** What the timeline shows that the engine produces: thumbnails and playback state. */
export interface AnimationView {
  /** Frame thumbnails (PNG data URLs) by frame id, rendered when drawing pauses. */
  thumbs: Record<string, string>;
  playing: boolean;
  /** 0–1 while frames are being prepared for playback; null otherwise. */
  preparing: number | null;
}

export const animationStore = createStore<AnimationView>()(() => ({
  thumbs: {},
  playing: false,
  preparing: null,
}));

export function useAnimationView<T>(selector: (s: AnimationView) => T): T {
  return useStore(animationStore, selector);
}
