import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** Layer thumbnails (PNG data URLs) by layer id, rendered by the engine when drawing pauses. */
export const thumbnailStore = createStore<{ urls: Record<string, string> }>()(() => ({ urls: {} }));

export function useThumbnail(layerId: string): string | undefined {
  return useStore(thumbnailStore, (s) => s.urls[layerId]);
}
