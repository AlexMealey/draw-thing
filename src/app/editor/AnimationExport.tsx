import { useRef, useState } from 'react';
import type { Engine } from '../../engine/Engine';
import { GIF_MIN_DELAY_CS } from '../../engine/frames/timing';
import type { ExportedFile } from '../../files/exportArtwork';
import {
  type AnimationFormat,
  exportAnimation,
  MAX_EXPORT_SIZE,
} from '../../files/exportAnimation';
import { MAX_FPS, MIN_FPS, useDocument } from '../../state/documentStore';
import { SliderRow } from '../ui/SliderRow';
import ui from '../ui/ui.module.css';

interface Props {
  engine: () => Engine | null;
  project: { name: string };
  busy: boolean;
  setBusy: (message: string | null) => void;
  onSave: (file: ExportedFile) => Promise<void>;
  onNotice: (message: string) => void;
}

const SCALES = [0.25, 0.5, 1, 2] as const;

/** Why this browser can't make MP4s, or null. (mp4.ts itself loads only when exporting.) */
const mp4Unavailable = () =>
  typeof VideoEncoder === 'undefined' ? 'This browser can’t encode video' : null;

const clampSize = (n: number) =>
  Math.min(MAX_EXPORT_SIZE, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));

/** Share → Animation: every frame as an animated GIF or an MP4 video. */
export function AnimationExport({ engine, project, busy, setBusy, onSave, onNotice }: Props) {
  const docW = useDocument((s) => s.width);
  const docH = useDocument((s) => s.height);
  const frames = useDocument((s) => s.frames);
  const docFps = useDocument((s) => s.animation.fps);
  const transparent = useDocument((s) => !s.background.visible);
  const [format, setFormat] = useState<AnimationFormat>('gif');
  const [scale, setScale] = useState<number | 'custom'>(1);
  const [custom, setCustom] = useState({ w: docW, h: docH });
  const [keepRatio, setKeepRatio] = useState(true);
  const [smooth, setSmooth] = useState(true);
  const [fps, setFps] = useState(docFps);
  const [loop, setLoop] = useState(true);
  const [repeat, setRepeat] = useState(1);
  const [progress, setProgress] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const noMp4 = mp4Unavailable();
  const size =
    scale === 'custom'
      ? { w: clampSize(custom.w), h: clampSize(custom.h) }
      : { w: clampSize(docW * scale), h: clampSize(docH * scale) };
  const out = format === 'mp4' ? { w: even(size.w), h: even(size.h) } : size;
  const ticks = frames.reduce((n, f) => n + f.hold, 0);
  const seconds = (ticks / fps) * (format === 'mp4' ? repeat : 1);
  const gifTooFast = format === 'gif' && 100 / fps < GIF_MIN_DELAY_CS;

  const setWidth = (w: number) =>
    setCustom(keepRatio ? { w, h: Math.round((w * docH) / docW) } : { ...custom, w });
  const setHeight = (h: number) =>
    setCustom(keepRatio ? { w: Math.round((h * docW) / docH), h } : { ...custom, h });

  const run = async () => {
    const e = engine();
    if (!e) return;
    e.setPlaying(false);
    const ac = new AbortController();
    abort.current = ac;
    const label = format === 'gif' ? 'GIF' : 'MP4';
    setBusy(`Exporting ${label}…`);
    setProgress('Starting…');
    try {
      const file = await exportAnimation(e, project, {
        format,
        width: size.w,
        height: size.h,
        smooth,
        fps,
        loop,
        repeat,
        signal: ac.signal,
        onProgress: (done, total) => setProgress(`Frame ${done} of ${total}`),
      });
      await onSave(file);
    } catch (err) {
      if (ac.signal.aborted) onNotice('Export cancelled');
      else {
        console.error(err);
        onNotice(err instanceof Error ? err.message : String(err));
      }
    } finally {
      abort.current = null;
      setProgress(null);
      setBusy(null);
    }
  };

  const radio = (value: AnimationFormat, label: string, disabled = false) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36 }}>
      <input
        type="radio"
        name="animation-format"
        value={value}
        checked={format === value}
        disabled={disabled}
        onChange={() => setFormat(value)}
      />
      {label}
    </label>
  );

  const muted = { margin: 0, fontSize: 13, color: 'var(--color-text-muted)' } as const;

  return (
    <section aria-label="Export animation">
      <h3 className={ui.section}>Animation</h3>
      <div role="radiogroup" aria-label="Animation format" style={{ display: 'flex', gap: 16 }}>
        {radio('gif', 'GIF')}
        {radio('mp4', 'MP4 video', !!noMp4)}
      </div>
      {noMp4 && <p style={muted}>{noMp4}, so MP4 isn’t available here.</p>}

      <label className={ui.switch}>
        Size
        <select
          className={ui.select}
          style={{ width: 'auto', minWidth: 120 }}
          aria-label="Size"
          value={String(scale)}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') setCustom(size);
            setScale(v === 'custom' ? 'custom' : Number(v));
          }}
        >
          {SCALES.map((s) => (
            <option key={s} value={String(s)}>
              {Math.round(s * 100)}% ({clampSize(docW * s)} × {clampSize(docH * s)})
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {scale === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="number"
            className={ui.select}
            style={{ width: 96 }}
            aria-label="Width"
            min={1}
            max={MAX_EXPORT_SIZE}
            value={custom.w}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          ×
          <input
            type="number"
            className={ui.select}
            style={{ width: 96 }}
            aria-label="Height"
            min={1}
            max={MAX_EXPORT_SIZE}
            value={custom.h}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
          px
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={keepRatio}
              onChange={(e) => setKeepRatio(e.target.checked)}
            />
            Keep proportions
          </label>
        </div>
      )}
      <label className={ui.switch}>
        Hard pixels (no smoothing)
        <input type="checkbox" checked={!smooth} onChange={(e) => setSmooth(!e.target.checked)} />
      </label>

      <SliderRow
        label="Frame rate"
        value={fps}
        min={MIN_FPS}
        max={MAX_FPS}
        step={1}
        unit={null}
        format={(v) => `${v} fps`}
        onChange={setFps}
      />
      {format === 'gif' ? (
        <label className={ui.switch}>
          Loop forever
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
        </label>
      ) : (
        <SliderRow
          label="Play"
          value={repeat}
          min={1}
          max={10}
          step={1}
          unit={null}
          format={(v) => `${v}×`}
          onChange={setRepeat}
        />
      )}
      <p style={muted}>
        {frames.length} {frames.length === 1 ? 'frame' : 'frames'} · {seconds.toFixed(2)} s ·{' '}
        {out.w} × {out.h} px
        {format === 'gif' && transparent && ' · transparent background'}
      </p>
      {gifTooFast && (
        <p style={muted}>GIFs can’t change faster than 50 times a second; it will play slower.</p>
      )}
      <p style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className={`${ui.textButton} ${ui.primary}`}
          disabled={busy}
          onClick={() => void run()}
        >
          Export {format === 'gif' ? 'GIF' : 'MP4'}
        </button>
        {progress && (
          <>
            <span role="status" style={muted}>
              {progress}
            </span>
            <button className={ui.textButton} onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          </>
        )}
      </p>
    </section>
  );
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
