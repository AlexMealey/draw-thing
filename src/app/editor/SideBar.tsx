import { useDocument } from '../../state/documentStore';
import { useHistory } from '../../state/historyStore';
import { currentAdjustments, maxBrushSize, toolStore, useTools } from '../../state/toolStore';
import { EyedropperIcon, RedoIcon, UndoIcon } from '../ui/icons';
import { percent } from '../ui/format';
import { heldStep, snapValue } from '../ui/sliderStep';
import ui from '../ui/ui.module.css';
import { VerticalSlider } from '../ui/VerticalSlider';
import styles from './SideBar.module.css';

interface Props {
  side: 'left' | 'right';
  eyedropper: boolean;
  onEyedropper: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Size grows with the cube of the slider position: the range reaches the canvas's shorter side,
 * and small brushes still get fine control.
 */
const sizeToPosition = (size: number, max: number) =>
  Math.cbrt(Math.max(0, (size - 1) / Math.max(1, max - 1)));
const positionToSize = (p: number, max: number) => Math.max(1, Math.round(1 + (max - 1) * p ** 3));

export function SideBar({ side, eyedropper, onEyedropper, onUndo, onRedo }: Props) {
  // Select numbers, not the adjustments object: its defaults are created on each read.
  const size = useTools((s) => currentAdjustments(s).size);
  const opacity = useTools((s) => currentAdjustments(s).opacity);
  const max = useDocument((d) => maxBrushSize(d.width, d.height));
  const undoLabel = useHistory((h) => h.undoLabel);
  const redoLabel = useHistory((h) => h.redoLabel);
  const bubble = side === 'right' ? 'left' : 'right';
  const set = toolStore.getState().adjust;

  return (
    <aside className={styles.sidebar} data-side={side} aria-label="Brush controls">
      <VerticalSlider
        label="Brush size"
        position={sizeToPosition(size, max)}
        display={`${size} px · ${Math.max(1, Math.round((size / max) * 100))}%`}
        onChange={(p, mods) => {
          const s = positionToSize(p, max);
          const step = heldStep(mods);
          set({ size: step ? snapValue(s, step, 1, max) : s });
        }}
        bubbleSide={bubble}
      />
      <button
        className={ui.iconButton}
        aria-label="Eyedropper"
        aria-pressed={eyedropper}
        title="Eyedropper (or touch and hold)"
        onClick={onEyedropper}
      >
        <EyedropperIcon />
      </button>
      <VerticalSlider
        label="Brush opacity"
        position={opacity}
        display={percent(opacity)}
        onChange={(p, mods) => {
          const step = heldStep(mods);
          set({ opacity: step ? snapValue(p, step / 100, 0.01, 1) : Math.max(0.01, p) });
        }}
        bubbleSide={bubble}
      />
      <button
        className={ui.iconButton}
        aria-label="Undo"
        title={undoLabel ? `Undo ${undoLabel}` : 'Nothing to undo'}
        disabled={!undoLabel}
        onClick={onUndo}
      >
        <UndoIcon />
      </button>
      <button
        className={ui.iconButton}
        aria-label="Redo"
        title={redoLabel ? `Redo ${redoLabel}` : 'Nothing to redo'}
        disabled={!redoLabel}
        onClick={onRedo}
      >
        <RedoIcon />
      </button>
    </aside>
  );
}
