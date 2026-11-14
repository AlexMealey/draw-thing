export interface OnionSettings {
  enabled: boolean;
  /** Frames shown before / after the active one. */
  before: number;
  after: number;
  /** Of the nearest neighbour; farther ones fade out. */
  opacity: number;
  /** Red before, green after (otherwise their own colors). */
  tint: boolean;
}

export const DEFAULT_ONION: OnionSettings = {
  enabled: false,
  before: 1,
  after: 1,
  opacity: 0.35,
  tint: true,
};

export const MAX_ONION_FRAMES = 5;
