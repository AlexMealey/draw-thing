import type { ToolMode } from '../../state/toolStore';
import {
  ActionsIcon,
  BrushIcon,
  EraserIcon,
  GalleryIcon,
  LayersIcon,
  ShareIcon,
} from '../ui/icons';
import ui from '../ui/ui.module.css';
import type { PanelId } from './EditorScreen';
import styles from './TopBar.module.css';

interface Props {
  open: PanelId | null;
  mode: ToolMode;
  color: string;
  onGallery: () => void;
  onToggle: (panel: PanelId) => void;
  /** Selecting the active tool again opens its brush library. */
  onTool: (mode: ToolMode) => void;
}

export function TopBar({ open, mode, color, onGallery, onToggle, onTool }: Props) {
  const brushes = open === 'brushes' || open === 'brushSettings';
  return (
    <header className={styles.topbar}>
      <div className={styles.group}>
        <button className={ui.iconButton} aria-label="Gallery" onClick={onGallery}>
          <GalleryIcon />
        </button>
        <button
          className={ui.iconButton}
          aria-label="Actions"
          aria-expanded={open === 'actions'}
          onClick={() => onToggle('actions')}
        >
          <ActionsIcon />
        </button>
        <button
          className={ui.iconButton}
          aria-label="Share"
          aria-expanded={open === 'share'}
          onClick={() => onToggle('share')}
        >
          <ShareIcon />
        </button>
      </div>
      <div className={styles.group}>
        <button
          className={ui.iconButton}
          aria-label="Brush"
          aria-pressed={mode === 'paint'}
          aria-expanded={brushes && mode === 'paint'}
          onClick={() => onTool('paint')}
        >
          <BrushIcon />
        </button>
        <button
          className={ui.iconButton}
          aria-label="Eraser"
          aria-pressed={mode === 'erase'}
          aria-expanded={brushes && mode === 'erase'}
          onClick={() => onTool('erase')}
        >
          <EraserIcon />
        </button>
        <button
          className={ui.iconButton}
          aria-label="Layers"
          aria-expanded={open === 'layers'}
          onClick={() => onToggle('layers')}
        >
          <LayersIcon />
        </button>
        <button
          className={styles.swatch}
          style={{ background: color }}
          aria-label="Color"
          aria-expanded={open === 'color'}
          onClick={() => onToggle('color')}
        />
      </div>
    </header>
  );
}
