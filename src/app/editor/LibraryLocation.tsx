import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  type FolderKind,
  inspectFolder,
  type LibraryInfo,
  libraryInfo,
  pickLibraryFolder,
  revealLibrary,
  setLibrary,
  subfolder,
} from '../../platform/desktop';
import { fileSize } from '../ui/format';
import { Modal } from '../ui/Modal';
import ui from '../ui/ui.module.css';

interface Props {
  /** Saves the open artwork. */
  flush: () => Promise<void>;
  onNotice: (message: string) => void;
}

/** A folder the user picked that the library can go to. */
interface Choice {
  path: string;
  kind: Extract<FolderKind, 'empty' | 'library'>;
}

const muted = { color: 'var(--color-text-muted)' };
const pathStyle = { overflowWrap: 'anywhere', fontSize: 13 } as const;

const REFUSED: Partial<Record<FolderKind, string>> = {
  current: 'That’s where your library already is',
  nested: 'That folder is inside your library',
  unwritable: 'DrawThing can’t save to that folder',
  'other-files': 'That folder’s DrawThing folder has other files in it',
};

/**
 * Desktop app: where the library folder is (artwork, brushes, palettes, preferences, Exports),
 * and moving or switching it.
 */
export default function LibraryLocation({ flush, onNotice }: Props) {
  const [info, setInfo] = useState<LibraryInfo | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    libraryInfo().then(
      (i) => !cancelled && setInfo(i),
      (err: unknown) => console.error('Couldn’t read the library location', err),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const change = async () => {
    try {
      const picked = await pickLibraryFolder();
      if (!picked) return;
      let path = picked;
      let kind = await inspectFolder(path);
      if (kind === 'other-files') {
        // A folder with other things in it (Documents, say): use a DrawThing folder inside it.
        path = subfolder(path);
        kind = await inspectFolder(path);
      }
      if (kind === 'empty' || kind === 'library') setChoice({ path, kind });
      else onNotice(REFUSED[kind] ?? 'That folder can’t be used');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const apply = async (mode: 'move' | 'switch') => {
    if (!choice) return;
    setBusy(mode === 'move' ? 'Moving your library…' : 'Opening the library…');
    try {
      await flush();
      await setLibrary(choice.path, mode); // reloads the app
    } catch (err) {
      setBusy(null);
      setChoice(null);
      onNotice(err instanceof Error ? err.message : String(err));
    }
  };

  if (!info) return null;

  return (
    <>
      <p style={{ margin: '4px 0', fontSize: 14 }}>
        Library: {fileSize(info.bytes)} in
        <br />
        <span style={{ ...pathStyle, ...muted }}>{info.path}</span>
      </p>
      {info.unavailable && (
        <p style={{ margin: '4px 0', fontSize: 13, ...muted }}>
          Couldn’t open {info.unavailable}, so this is the default library for now.
        </p>
      )}
      <p style={{ margin: '4px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={ui.textButton} onClick={() => void change()}>
          Change location…
        </button>
        <button
          className={ui.textButton}
          onClick={() => void revealLibrary().catch((err: unknown) => onNotice(String(err)))}
        >
          Show in folder
        </button>
      </p>
      {choice &&
        createPortal(
          <Modal
            title={choice.kind === 'empty' ? 'Move your library?' : 'Switch library?'}
            onClose={() => !busy && setChoice(null)}
          >
            {choice.kind === 'empty' ? (
              <p>
                Move your artwork, brushes, palettes and preferences to
                <br />
                <span style={pathStyle}>{choice.path}</span>?
              </p>
            ) : (
              <p>
                <span style={pathStyle}>{choice.path}</span>
                <br />
                already has a DrawThing library. Switch to it? Your current library stays where it
                is, and you can switch back.
              </p>
            )}
            {busy ? (
              <p style={muted}>{busy}</p>
            ) : (
              <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button className={ui.textButton} onClick={() => setChoice(null)}>
                  Cancel
                </button>
                {choice.kind === 'empty' && (
                  <button className={ui.textButton} onClick={() => void apply('switch')}>
                    Start an empty library
                  </button>
                )}
                <button
                  className={`${ui.textButton} ${ui.primary}`}
                  onClick={() => void apply(choice.kind === 'empty' ? 'move' : 'switch')}
                >
                  {choice.kind === 'empty' ? 'Move' : 'Switch'}
                </button>
              </p>
            )}
          </Modal>,
          document.body,
        )}
    </>
  );
}
