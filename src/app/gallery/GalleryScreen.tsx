import { useEffect, useState } from 'react';
import { MAX_DOC_SIZE, screenDocSize } from '../../engine/limits';
import { gpuBudgetBytes, maxLayersFor } from '../../engine/layers/budget';
import { chooseFile, deliver } from '../../files/deliver';
import { exportProjectFile } from '../../files/exportArtwork';
import { IMPORT_ACCEPT, importAsProject } from '../../files/importFile';
import {
  deleteProject,
  duplicateProject,
  listProjects,
  type ProjectSummary,
  renameProject,
} from '../../persistence/projects';
import { PlusIcon } from '../ui/icons';
import ui from '../ui/ui.module.css';
import styles from './GalleryScreen.module.css';

interface Size {
  w: number;
  h: number;
}

type Listed = ProjectSummary & { thumbUrl: string | null };

interface Props {
  /** The artwork open in the editor; `thumbnail` stands in while it isn't stored yet. */
  current: { id: string; thumbnail: string | null; size: Size };
  /** Start with the new-canvas picker open. */
  startNew?: boolean;
  onOpenCurrent: () => void;
  onOpen: (id: string) => void;
  onCreate: (size: Size) => void;
  /** Called before a project is deleted (the editor stops saving it if it's open). */
  onDelete: (id: string) => Promise<void>;
  onRenamed: (id: string, name: string) => void;
  onNotice: (message: string) => void;
}

export function GalleryScreen({
  current,
  startNew = false,
  onOpenCurrent,
  onOpen,
  onCreate,
  onDelete,
  onRenamed,
  onNotice,
}: Props) {
  const [picking, setPicking] = useState(startNew);
  const [projects, setProjects] = useState<Listed[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => setVersion((v) => v + 1);

  // Thumbnail object URLs live as long as this listing.
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    listProjects()
      .then((list) => {
        if (cancelled) return;
        setProjects(
          list.map((p) => {
            const thumbUrl = p.thumb ? URL.createObjectURL(p.thumb) : null;
            if (thumbUrl) urls.push(thumbUrl);
            return { ...p, thumbUrl };
          }),
        );
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
      // Revoked after the next listing has rendered, so thumbnails don't flash.
      setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 1000);
    };
  }, [version]);

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    try {
      await job();
    } catch (err) {
      console.error(err);
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const importFile = async () => {
    const file = await chooseFile(IMPORT_ACCEPT);
    if (!file) return;
    await run(`Importing ${file.name}…`, async () => {
      const { note } = await importAsProject(file);
      onNotice(note ?? `Imported ${file.name}`);
      reload();
    });
  };

  const stored = projects?.some((p) => p.id === current.id) ?? false;

  return (
    <div className={styles.gallery} role="dialog" aria-label="Gallery">
      <header className={styles.header}>
        <h1>DrawThing</h1>
        <div className={styles.headerButtons}>
          <button className={ui.textButton} onClick={() => void importFile()} disabled={!!busy}>
            Import
          </button>
          <button className={`${ui.textButton} ${ui.primary}`} onClick={() => setPicking(true)}>
            <PlusIcon /> New canvas
          </button>
        </div>
      </header>
      {busy && (
        <p className={styles.status} role="status">
          {busy}
        </p>
      )}
      <ul className={styles.grid} aria-label="Artworks">
        {!stored && (
          <li>
            <button className={styles.card} onClick={onOpenCurrent}>
              <Thumb src={current.thumbnail} />
              <span>Current canvas</span>
              <small>
                {current.size.w} × {current.size.h} px · not saved until you draw
              </small>
            </button>
          </li>
        )}
        {projects?.map((p) => (
          <Card
            key={p.id}
            project={p}
            current={p.id === current.id}
            disabled={!!busy}
            onOpen={() => (p.id === current.id ? onOpenCurrent() : onOpen(p.id))}
            onRename={(name) =>
              run('Renaming…', async () => {
                await renameProject(p.id, name);
                onRenamed(p.id, name);
                reload();
              })
            }
            onDuplicate={() =>
              run('Duplicating…', async () => {
                await duplicateProject(p.id);
                reload();
              })
            }
            onShare={() =>
              run('Exporting…', async () => {
                const file = await exportProjectFile(p.id);
                if ((await deliver(file.blob, file.filename)) === 'needs-tap') {
                  onNotice('Tap Share again to save the file');
                }
              })
            }
            onDelete={() =>
              run('Deleting…', async () => {
                await onDelete(p.id);
                await deleteProject(p.id);
                reload();
              })
            }
          />
        ))}
      </ul>
      {projects?.length === 0 && (
        <p className={styles.empty}>Your artworks are saved here as you draw.</p>
      )}
      {picking && <NewCanvas onCancel={() => setPicking(false)} onCreate={onCreate} />}
    </div>
  );
}

/** The artwork's thumbnail, letterboxed; the checkerboard shows only through the artwork. */
function Thumb({ src }: { src: string | null }) {
  return (
    <span className={styles.frame}>
      {src ? (
        <img className={ui.checker} src={src} alt="" />
      ) : (
        <span className={`${styles.placeholder} ${ui.checker}`} />
      )}
    </span>
  );
}

function Card({
  project,
  current,
  disabled,
  onOpen,
  onRename,
  onDuplicate,
  onShare,
  onDelete,
}: {
  project: Listed;
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState<'closed' | 'open' | 'rename' | 'delete'>('closed');
  const [name, setName] = useState(project.name);
  const edited = new Date(project.updatedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <li className={styles.item}>
      <button className={styles.card} onClick={onOpen} aria-label={`Open ${project.name}`}>
        <Thumb src={project.thumbUrl} />
        <span>
          {project.name}
          {current && <em className={styles.badge}>Open</em>}
        </span>
        <small>
          {project.width} × {project.height} px · {edited}
        </small>
      </button>
      <button
        className={styles.more}
        aria-label={`${project.name} options`}
        aria-expanded={menu !== 'closed'}
        onClick={() => setMenu((m) => (m === 'closed' ? 'open' : 'closed'))}
      >
        •••
      </button>
      {menu === 'open' && (
        <div className={styles.menu} role="menu">
          <button role="menuitem" onClick={() => setMenu('rename')}>
            Rename
          </button>
          <button
            role="menuitem"
            disabled={disabled}
            onClick={() => (setMenu('closed'), onDuplicate())}
          >
            Duplicate
          </button>
          <button
            role="menuitem"
            disabled={disabled}
            onClick={() => (setMenu('closed'), onShare())}
          >
            Share as .drawthing
          </button>
          <button role="menuitem" className={styles.danger} onClick={() => setMenu('delete')}>
            Delete
          </button>
        </div>
      )}
      {menu === 'rename' && (
        <form
          className={styles.menu}
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (n && n !== project.name) onRename(n.slice(0, 200));
            setMenu('closed');
          }}
        >
          <input
            aria-label="Name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setMenu('closed')}
          />
          <button type="submit">Rename</button>
        </form>
      )}
      {menu === 'delete' && (
        <div className={styles.menu} role="alertdialog" aria-label={`Delete ${project.name}?`}>
          <p>Delete “{project.name}”? This can’t be undone.</p>
          <button onClick={() => setMenu('closed')}>Cancel</button>
          <button
            className={styles.danger}
            disabled={disabled}
            onClick={() => (setMenu('closed'), onDelete())}
          >
            Delete
          </button>
        </div>
      )}
    </li>
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
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (size: Size) => void;
}) {
  const [list] = useState(presets);
  const [choice, setChoice] = useState<number | 'custom'>(0);
  const [custom, setCustom] = useState<Size>({ w: 2000, h: 1500 });
  const budget = gpuBudgetBytes();
  const clampSide = (v: number) => Math.min(MAX_DOC_SIZE, Math.max(64, Math.round(v) || 64));
  const size =
    choice === 'custom' ? { w: clampSide(custom.w), h: clampSide(custom.h) } : list[choice]!.size;
  const limit = (s: Size) => maxLayersFor(s.w * s.h * 4, budget);

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
        <div className={styles.buttons}>
          <button className={ui.textButton} onClick={onCancel}>
            Cancel
          </button>
          <button className={`${ui.textButton} ${ui.primary}`} onClick={() => onCreate(size)}>
            Create
          </button>
        </div>
      </section>
    </div>
  );
}
