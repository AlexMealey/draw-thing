import { useState } from 'react';
import { MAX_DOC_SIZE, screenDocSize } from '../../engine/Engine';
import { gpuBudgetBytes, maxLayersFor } from '../../engine/layers/budget';
import { PlusIcon } from '../ui/icons';
import ui from '../ui/ui.module.css';
import styles from './GalleryScreen.module.css';

interface Size {
  w: number;
  h: number;
}

interface Props {
  current: { thumbnail: string | null; size: Size } | null;
  /** True when the open canvas has unsaved work (saving arrives in Phase 6). */
  hasWork: boolean;
  /** Start with the new-canvas picker open. */
  startNew?: boolean;
  onOpenCurrent: () => void;
  onCreate: (size: Size) => void;
}

export function GalleryScreen({
  current,
  hasWork,
  startNew = false,
  onOpenCurrent,
  onCreate,
}: Props) {
  const [picking, setPicking] = useState(startNew);

  return (
    <div className={styles.gallery} role="dialog" aria-label="Gallery">
      <header className={styles.header}>
        <h1>DrawThing</h1>
        <button className={`${ui.textButton} ${ui.primary}`} onClick={() => setPicking(true)}>
          <PlusIcon /> New canvas
        </button>
      </header>
      <div className={styles.grid}>
        {current && (
          <button className={styles.card} onClick={onOpenCurrent}>
            {current.thumbnail ? (
              <img className={ui.checker} src={current.thumbnail} alt="" />
            ) : (
              <span className={`${styles.placeholder} ${ui.checker}`} />
            )}
            <span>Current canvas</span>
            <small>
              {current.size.w} × {current.size.h} px
            </small>
          </button>
        )}
        <p className={styles.empty}>
          Saved artworks will appear here once saving arrives (Phase 6).
        </p>
      </div>
      {picking && (
        <NewCanvas hasWork={hasWork} onCancel={() => setPicking(false)} onCreate={onCreate} />
      )}
    </div>
  );
}

function presets(): { name: string; size: Size }[] {
  return [
    { name: 'Screen size', size: screenDocSize() },
    { name: 'Square', size: { w: 2048, h: 2048 } },
    { name: '4K', size: { w: 3840, h: 2160 } },
    { name: 'A4 at 300 dpi', size: { w: 2480, h: 3508 } },
    { name: 'Comic page', size: { w: 1988, h: 3056 } },
  ];
}

function NewCanvas({
  hasWork,
  onCancel,
  onCreate,
}: {
  hasWork: boolean;
  onCancel: () => void;
  onCreate: (size: Size) => void;
}) {
  const [list] = useState(presets);
  const [choice, setChoice] = useState<number | 'custom'>(0);
  const [custom, setCustom] = useState<Size>({ w: 2000, h: 1500 });
  const [confirming, setConfirming] = useState(false);
  const budget = gpuBudgetBytes();
  const clampSide = (v: number) => Math.min(MAX_DOC_SIZE, Math.max(64, Math.round(v) || 64));
  const size =
    choice === 'custom' ? { w: clampSide(custom.w), h: clampSide(custom.h) } : list[choice]!.size;
  const limit = (s: Size) => maxLayersFor(s.w * s.h * 4, budget);

  const create = () => {
    if (hasWork && !confirming) setConfirming(true);
    else onCreate(size);
  };

  return (
    <div className={styles.dialog} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <section className={styles.sheet} role="dialog" aria-label="New canvas">
        <h2>New canvas</h2>
        <ul className={styles.sizes} role="radiogroup" aria-label="Canvas size">
          {list.map((p, i) => (
            <li key={p.name}>
              <button
                className={styles.size}
                role="radio"
                aria-checked={choice === i}
                onClick={() => setChoice(i)}
              >
                {p.name}
                <small>
                  {p.size.w} × {p.size.h} px
                </small>
                <em>up to {limit(p.size)} layers</em>
              </button>
            </li>
          ))}
          <li>
            <button
              className={styles.size}
              role="radio"
              aria-checked={choice === 'custom'}
              onClick={() => setChoice('custom')}
            >
              Custom
              <small>Up to {MAX_DOC_SIZE} px per side</small>
              <em>up to {limit({ w: clampSide(custom.w), h: clampSide(custom.h) })} layers</em>
            </button>
          </li>
        </ul>
        {choice === 'custom' && (
          <div className={styles.custom}>
            <input
              type="number"
              aria-label="Width"
              min={64}
              max={MAX_DOC_SIZE}
              value={custom.w}
              onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) })}
            />
            ×
            <input
              type="number"
              aria-label="Height"
              min={64}
              max={MAX_DOC_SIZE}
              value={custom.h}
              onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) })}
            />
            px
          </div>
        )}
        {confirming && (
          <p className={styles.warning} role="alert">
            The current canvas isn’t saved (saving arrives in Phase 6). Creating a new one discards
            it.
          </p>
        )}
        <div className={styles.buttons}>
          <button className={ui.textButton} onClick={onCancel}>
            Cancel
          </button>
          <button className={`${ui.textButton} ${ui.primary}`} onClick={create}>
            {confirming ? 'Discard and create' : 'Create'}
          </button>
        </div>
      </section>
    </div>
  );
}
