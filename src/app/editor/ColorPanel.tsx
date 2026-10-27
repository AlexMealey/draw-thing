import { activePalette, paletteStore, usePalettes } from '../../state/paletteStore';
import { toolStore, useTools } from '../../state/toolStore';
import { PlusIcon } from '../ui/icons';
import { Panel } from '../ui/Panel';
import ui from '../ui/ui.module.css';
import { ColorPicker } from './ColorPicker';
import styles from './ColorPanel.module.css';

interface Props {
  onClose: () => void;
  /** Opens the palettes window. */
  onPalettes: () => void;
}

/** The color picker, recent colors and the palette chosen in the palettes window. */
export function ColorPanel({ onClose, onPalettes }: Props) {
  const color = useTools((s) => s.color);
  const recent = useTools((s) => s.recentColors);
  const sliders = useTools((s) => s.colorSliders);
  const palette = usePalettes(activePalette);
  const { setColor } = toolStore.getState();

  return (
    <Panel title="Color" onClose={onClose}>
      <ColorPicker sliders={sliders} />

      {recent.length > 0 && (
        <>
          <h3 className={ui.section}>Recent</h3>
          <div className={styles.swatches}>
            {recent.map((c) => (
              <button
                key={c}
                style={{ background: c }}
                aria-label={`Recent ${c}`}
                onClick={() => setColor(c, true)}
              />
            ))}
          </div>
        </>
      )}

      <div className={styles.paletteHeader}>
        <h3 className={ui.section}>{palette ? palette.name : 'Palette'}</h3>
        <button className={ui.textButton} onClick={onPalettes}>
          Palettes…
        </button>
      </div>
      {palette ? (
        <div className={styles.swatches}>
          {palette.colors.map((c, i) => (
            <button
              key={i}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              aria-pressed={c === color}
              onClick={() => setColor(c, true)}
            />
          ))}
          <button
            className={styles.add}
            aria-label="Add current color to palette"
            onClick={() => paletteStore.getState().addColor(palette.id, color)}
          >
            <PlusIcon />
          </button>
        </div>
      ) : (
        <p className={styles.empty}>No palette yet.</p>
      )}
    </Panel>
  );
}
