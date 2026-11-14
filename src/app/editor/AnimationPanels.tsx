import type { Engine } from '../../engine/Engine';
import { MAX_ONION_FRAMES } from '../../engine/frames/onion';
import {
  documentStore,
  frameIndex,
  MAX_FPS,
  MIN_FPS,
  useDocument,
} from '../../state/documentStore';
import { toolStore, useTools } from '../../state/toolStore';
import { Panel } from '../ui/Panel';
import { SliderRow } from '../ui/SliderRow';
import ui from '../ui/ui.module.css';

/** The longest hold the slider offers (the document allows more). */
const HOLD_SLIDER_MAX = 24;

const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;

/** Options for the active frame: how long it holds, clone, insert, move and delete. */
export function FramePanel({
  engine,
  onClose,
}: {
  engine: () => Engine | null;
  onClose: () => void;
}) {
  const frames = useDocument((s) => s.frames);
  const index = useDocument(frameIndex);
  const fps = useDocument((s) => s.animation.fps);
  const frame = frames[index];
  if (!frame) return null;
  const doc = () => documentStore.getState();
  const row = { display: 'flex', gap: 8, flexWrap: 'wrap' } as const;

  return (
    <Panel title={`Frame ${index + 1} of ${frames.length}`} onClose={onClose}>
      <SliderRow
        label="Hold"
        value={Math.min(frame.hold, HOLD_SLIDER_MAX)}
        min={1}
        max={HOLD_SLIDER_MAX}
        step={1}
        unit={null}
        format={() => `×${frame.hold}`}
        onChange={(v) => doc().setFrameHold(frame.id, v)}
      />
      <p style={{ margin: '0 0 var(--space-2)', fontSize: 13, color: 'var(--color-text-muted)' }}>
        On screen for {ms(frame.hold / fps)} ({frame.hold} {frame.hold === 1 ? 'tick' : 'ticks'} at{' '}
        {fps} fps)
      </p>
      <p style={row}>
        <button className={ui.textButton} onClick={() => engine()?.cloneFrame() && onClose()}>
          Clone
        </button>
        <button className={ui.textButton} onClick={() => engine()?.newFrame() && onClose()}>
          Insert blank after
        </button>
      </p>
      <p style={row}>
        <button
          className={ui.textButton}
          disabled={index === 0}
          onClick={() => doc().moveFrame(frame.id, index - 1)}
        >
          Move earlier
        </button>
        <button
          className={ui.textButton}
          disabled={index === frames.length - 1}
          onClick={() => doc().moveFrame(frame.id, index + 1)}
        >
          Move later
        </button>
        <button
          className={`${ui.textButton} ${ui.danger}`}
          disabled={frames.length <= 1}
          onClick={() => engine()?.deleteFrame(frame.id) && onClose()}
        >
          Delete
        </button>
      </p>
    </Panel>
  );
}

/** Frame rate and onion skin. */
export function AnimationPanel({ onClose }: { onClose: () => void }) {
  const fps = useDocument((s) => s.animation.fps);
  const frames = useDocument((s) => s.frames);
  const onion = useTools((s) => s.onion);
  const setOnion = (patch: Partial<typeof onion>) =>
    toolStore.getState().setPrefs({ onion: { ...onion, ...patch } });
  const ticks = frames.reduce((n, f) => n + f.hold, 0);

  return (
    <Panel title="Animation" onClose={onClose}>
      <h3 className={ui.section}>Playback</h3>
      <SliderRow
        label="Frame rate"
        value={fps}
        min={MIN_FPS}
        max={MAX_FPS}
        step={1}
        unit={null}
        format={(v) => `${v} fps`}
        onChange={(v) => documentStore.getState().setAnimation({ fps: v })}
      />
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
        {frames.length} {frames.length === 1 ? 'frame' : 'frames'}, {ms(ticks / fps)} per loop. Each
        frame shows for its hold × 1/{fps} s.
      </p>

      <h3 className={ui.section}>Onion skin</h3>
      <label className={ui.switch}>
        Show neighbouring frames
        <input
          type="checkbox"
          checked={onion.enabled}
          onChange={(e) => setOnion({ enabled: e.target.checked })}
        />
      </label>
      <SliderRow
        label="Before"
        value={onion.before}
        min={0}
        max={MAX_ONION_FRAMES}
        step={1}
        unit={null}
        format={(v) => `${v}`}
        onChange={(v) => setOnion({ before: v })}
      />
      <SliderRow
        label="After"
        value={onion.after}
        min={0}
        max={MAX_ONION_FRAMES}
        step={1}
        unit={null}
        format={(v) => `${v}`}
        onChange={(v) => setOnion({ after: v })}
      />
      <SliderRow
        label="Opacity"
        value={onion.opacity}
        min={0.05}
        max={1}
        step={0.01}
        unit={100}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => setOnion({ opacity: v })}
      />
      <label className={ui.switch}>
        Tint (red before, green after)
        <input
          type="checkbox"
          checked={onion.tint}
          onChange={(e) => setOnion({ tint: e.target.checked })}
        />
      </label>

      <h3 className={ui.section}>Timeline</h3>
      <p>
        <button
          className={ui.textButton}
          onClick={() => {
            documentStore.getState().setAnimation({ enabled: false });
            onClose();
          }}
        >
          Hide timeline
        </button>
      </p>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>
        Frames are kept; turn the timeline back on under Actions → Canvas. Export a GIF or MP4 from
        Share.
      </p>
    </Panel>
  );
}
