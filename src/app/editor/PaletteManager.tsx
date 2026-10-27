import { useEffect, useMemo, useState } from 'react';
import { chooseFile, deliver, fileName } from '../../files/deliver';
import { decodeImage, fitImage } from '../../files/image';
import { IMAGE_ACCEPT } from '../../files/importFile';
import { type Palette, paletteStore, usePalettes } from '../../state/paletteStore';
import { toolStore, useTools } from '../../state/toolStore';
import { extractColors } from '../palette/extract';
import { encodePalette, type PaletteFormat, readPaletteFile } from '../palette/formats';
import { PlusIcon } from '../ui/icons';
import { Modal } from '../ui/Modal';
import ui from '../ui/ui.module.css';
import colorStyles from './ColorPanel.module.css';
import { ColorPicker } from './ColorPicker';
import styles from './PaletteManager.module.css';

interface Props {
  onClose: () => void;
  onNotice: (message: string) => void;
}

/** Palette files are told apart by content, so any file may be picked (iPadOS hides unknown types). */
const PALETTE_ACCEPT = '.swatches,.gpl,.txt,application/zip,text/plain';
/** Longest side the image is shrunk to before its colors are extracted, px. */
const SAMPLE_SIZE = 128;
const DEFAULT_IMAGE_COLORS = 10;

interface ImageSource {
  url: string;
  pixels: ImageData;
  name: string;
}

/**
 * The palettes window: create, rename and delete palettes, add the current color or remove colors,
 * choose the one the color panel shows, import/export `.swatches` and `.gpl` files, and make a
 * palette from the colors of an image.
 */
export function PaletteManager({ onClose, onNotice }: Props) {
  const palettes = usePalettes((s) => s.palettes);
  const activeId = usePalettes((s) => s.activeId);
  const store = paletteStore.getState();
  const [selectedId, setSelectedId] = useState(activeId);
  const selected = palettes.find((p) => p.id === selectedId) ?? palettes[0] ?? null;
  const [image, setImage] = useState<ImageSource | null>(null);

  const importFile = async () => {
    const file = await chooseFile(PALETTE_ACCEPT);
    if (!file) return;
    try {
      const list = await readPaletteFile(file);
      const ids = store.importPalettes(list);
      setSelectedId(ids[0] ?? null);
      const first = list[0]!;
      onNotice(
        list.length === 1
          ? `Imported “${first.name}” (${first.colors.length} colors)`
          : `Imported ${list.length} palettes`,
      );
    } catch (err) {
      console.error(err);
      onNotice('Couldn’t read that palette file');
    }
  };

  const chooseImage = async () => {
    const file = await chooseFile(IMAGE_ACCEPT);
    if (!file) return;
    try {
      const bitmap = await decodeImage(file);
      const pixels = fitImage(bitmap, SAMPLE_SIZE, SAMPLE_SIZE);
      bitmap.close();
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Image';
      setImage({ url: URL.createObjectURL(file), pixels, name });
    } catch (err) {
      console.error(err);
      onNotice('Couldn’t open that image');
    }
  };

  return (
    <Modal title="Palettes" width={720} onClose={onClose}>
      {image ? (
        <FromImage
          source={image}
          onCancel={() => setImage(null)}
          onCreate={(name, colors) => {
            setSelectedId(store.create(name, colors));
            setImage(null);
          }}
        />
      ) : (
        <div className={styles.columns}>
          <div>
            <ul className={styles.list} aria-label="Palettes">
              {palettes.map((p) => (
                <li key={p.id}>
                  <button
                    className={styles.item}
                    aria-pressed={p.id === selected?.id}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <span className={styles.itemName}>
                      {p.name}
                      {p.id === activeId && <small> · in Color panel</small>}
                    </span>
                    <span className={styles.strip} aria-hidden="true">
                      {p.colors.slice(0, 12).map((c, i) => (
                        <span key={i} style={{ background: c }} />
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.buttons}>
              <button
                className={ui.textButton}
                onClick={() => setSelectedId(store.create('Palette'))}
              >
                New
              </button>
              <button className={ui.textButton} onClick={() => void importFile()}>
                Import…
              </button>
              <button className={ui.textButton} onClick={() => void chooseImage()}>
                From image…
              </button>
            </div>
          </div>
          {selected ? (
            <PaletteEditor key={selected.id} palette={selected} onNotice={onNotice} />
          ) : (
            <p className={colorStyles.empty}>No palettes. Make a new one or import a file.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

function PaletteEditor({
  palette,
  onNotice,
}: {
  palette: Palette;
  onNotice: (message: string) => void;
}) {
  const color = useTools((s) => s.color);
  const activeId = usePalettes((s) => s.activeId);
  const store = paletteStore.getState();
  const [removing, setRemoving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rename = (name: string) => {
    if (name.trim() && name.trim() !== palette.name) store.rename(palette.id, name);
  };

  const exportAs = async (format: PaletteFormat) => {
    try {
      const name = fileName(palette.name, format);
      const result = await deliver(encodePalette(palette, format), name);
      if (result === 'saved') onNotice(`Exported ${name}`);
      else if (result === 'needs-tap') onNotice('Tap Export again to save the file');
    } catch (err) {
      console.error(err);
      onNotice('Couldn’t export the palette');
    }
  };

  return (
    <div className={styles.editor}>
      <input
        key={palette.name}
        className={styles.name}
        aria-label="Palette name"
        defaultValue={palette.name}
        spellCheck={false}
        onBlur={(e) => rename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <div className={`${colorStyles.swatches} ${removing ? styles.removing : ''}`}>
        {palette.colors.map((c, i) => (
          <button
            key={i}
            style={{ background: c }}
            aria-label={removing ? `Remove ${c}` : `Use ${c}`}
            aria-pressed={!removing && c === color}
            onClick={() =>
              removing ? store.removeColor(palette.id, i) : toolStore.getState().setColor(c, true)
            }
          />
        ))}
        <button
          className={colorStyles.add}
          aria-label="Add current color"
          onClick={() => store.addColor(palette.id, color)}
        >
          <PlusIcon />
        </button>
      </div>
      <div className={styles.buttons}>
        <button
          className={ui.textButton}
          aria-pressed={removing}
          disabled={!removing && palette.colors.length === 0}
          onClick={() => setRemoving((r) => !r)}
        >
          {removing ? 'Done' : 'Remove colors'}
        </button>
        <button
          className={ui.textButton}
          disabled={palette.id === activeId}
          onClick={() => store.setActive(palette.id)}
        >
          Show in Color panel
        </button>
      </div>

      <h3 className={ui.section}>Pick a color</h3>
      <ColorPicker sliders={false} />

      <div className={styles.buttons}>
        <button className={ui.textButton} onClick={() => void exportAs('swatches')}>
          Export .swatches
        </button>
        <button className={ui.textButton} onClick={() => void exportAs('gpl')}>
          Export .gpl
        </button>
        {confirmDelete ? (
          <>
            <button className={ui.textButton} onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
            <button
              className={`${ui.textButton} ${ui.danger}`}
              onClick={() => store.remove(palette.id)}
            >
              Delete {palette.name}
            </button>
          </>
        ) : (
          <button
            className={`${ui.textButton} ${ui.danger}`}
            onClick={() => setConfirmDelete(true)}
          >
            Delete palette
          </button>
        )}
      </div>
    </div>
  );
}

function FromImage({
  source,
  onCancel,
  onCreate,
}: {
  source: ImageSource;
  onCancel: () => void;
  onCreate: (name: string, colors: string[]) => void;
}) {
  const [count, setCount] = useState(DEFAULT_IMAGE_COLORS);
  const [name, setName] = useState(source.name);
  const colors = useMemo(() => extractColors(source.pixels, count), [source.pixels, count]);

  useEffect(() => () => URL.revokeObjectURL(source.url), [source.url]);

  return (
    <div className={styles.fromImage}>
      <img className={`${styles.preview} ${ui.checker}`} src={source.url} alt="" />
      <div>
        <label className={ui.row}>
          <span>Colors</span>
          <input
            type="range"
            min={2}
            max={30}
            step={1}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
          <output>{count}</output>
        </label>
        <div className={colorStyles.swatches} role="list" aria-label="Extracted colors">
          {colors.map((c) => (
            <span
              key={c}
              className={styles.swatch}
              role="listitem"
              aria-label={c}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
        {colors.length < count && (
          <p className={colorStyles.empty}>Only {colors.length} distinct colors found.</p>
        )}
        <input
          className={styles.name}
          aria-label="Palette name"
          value={name}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
        />
        <div className={styles.buttons}>
          <button className={ui.textButton} onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`${ui.textButton} ${ui.primary}`}
            disabled={colors.length === 0}
            onClick={() => onCreate(name, colors)}
          >
            Create palette
          </button>
        </div>
      </div>
    </div>
  );
}
