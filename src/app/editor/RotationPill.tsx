import { useView } from '../../state/viewStore';
import { RotateIcon } from '../ui/icons';
import styles from './RotationPill.module.css';

interface Props {
  /** Which side the sidebar is on: the pill centers on the canvas area left clear. */
  side: 'left' | 'right';
  onReset: () => void;
}

/** Shows the canvas angle while it's turned; tapping it turns the canvas back to 0°. */
export function RotationPill({ side, onReset }: Props) {
  const rotation = useView((s) => s.rotation);
  if (rotation === 0) return null;
  const degrees = Math.round(rotation);
  return (
    <button
      className={styles.pill}
      data-side={side}
      aria-label={`Reset rotation (${degrees}°)`}
      title="Reset rotation to 0°"
      onClick={onReset}
    >
      <RotateIcon />
      {degrees}°
    </button>
  );
}
