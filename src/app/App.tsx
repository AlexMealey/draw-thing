import { useCallback, useEffect, useRef, useState } from 'react';
import { DebugHud } from '../debug/DebugHud';
import { screenDocSize } from '../engine/limits';
import { importAsProject } from '../files/importFile';
import { setLastOpen } from '../persistence/projects';
import { currentPlatform } from '../platform/env';
import { coachAtLaunch, installRoute } from '../platform/install';
import { applyUpdate, pwaStore, usePwa } from '../platform/pwa';
import { toolStore } from '../state/toolStore';
import { EditorScreen } from './editor/EditorScreen';
import { GalleryScreen } from './gallery/GalleryScreen';
import { InstallCoach } from './InstallCoach';
import { newProject, openLast, type OpenProject, openProject, type Session } from './project';
import { Toast } from './Toast';
import { UpdatePrompt } from './UpdatePrompt';

type Gallery = { open: false } | { open: true; startNew: boolean; thumbnail: string | null };

export function App({ debug }: { debug: boolean }) {
  const session = useRef<Session | null>(null);
  const [project, setProject] = useState<OpenProject | null>(null);
  const [gallery, setGallery] = useState<Gallery>({ open: false });
  const [notice, setNotice] = useState<string | null>(null);
  const [platform] = useState(currentPlatform);
  const canPrompt = usePwa((s) => s.installPrompt !== null);
  const route = installRoute(platform, canPrompt);
  const [coach, setCoach] = useState(() =>
    coachAtLaunch(installRoute(platform, false), toolStore.getState().installCoachSeen),
  );
  const updateReady = usePwa((s) => s.updateReady);
  const [savedSinceUpdate, setSavedSinceUpdate] = useState(false);
  const [updateSnoozed, setUpdateSnoozed] = useState(false);
  const launchFiles = usePwa((s) => s.launchFiles);

  // Launch into the artwork that was open last (it's at most one autosave behind).
  useEffect(() => {
    let cancelled = false;
    void openLast(screenDocSize()).then((p) => !cancelled && setProject(p));
    return () => {
      cancelled = true;
    };
  }, []);

  const getEngine = useCallback(() => session.current?.engine ?? null, []);
  const onSession = useCallback((s: Session | null) => {
    session.current = s;
  }, []);
  const flush = useCallback(() => session.current?.saver.flush() ?? Promise.resolve(), []);
  const clearNotice = useCallback(() => setNotice(null), []);
  // An update is offered right after a save, never in the middle of a stroke.
  const onSaved = useCallback(() => {
    if (pwaStore.getState().updateReady) setSavedSinceUpdate(true);
  }, []);
  const restart = useCallback(() => void applyUpdate(flush), [flush]);
  const showCoach = useCallback(() => setCoach(true), []);

  const openGallery = async (startNew: boolean) => {
    const thumbnail = session.current?.engine.documentThumbnail() ?? null;
    await flush(); // so the gallery shows the latest state
    setGallery({ open: true, startNew, thumbnail });
    setUpdateSnoozed(false);
  };

  const open = useCallback(
    async (id: string) => {
      try {
        await flush();
        const p = await openProject(id);
        if (!p) return setNotice('That artwork no longer exists');
        setProject(p);
        setGallery({ open: false });
        void setLastOpen(id);
      } catch (err) {
        console.error(err);
        setNotice('Couldn’t open that artwork');
      }
    },
    [flush],
  );

  // "Open with DrawThing": each file becomes a new artwork; the last one opens.
  const ready = project !== null;
  useEffect(() => {
    if (!launchFiles || !ready) return;
    pwaStore.setState({ launchFiles: null });
    void (async () => {
      let last: string | null = null;
      const notes: string[] = [];
      for (const file of launchFiles) {
        setNotice(`Opening ${file.name}…`);
        try {
          const imported = await importAsProject(file);
          last = imported.id;
          if (imported.note) notes.push(imported.note);
        } catch (err) {
          console.error(err);
          notes.push(err instanceof Error ? err.message : String(err));
        }
      }
      if (last) await open(last);
      setNotice(notes.length > 0 ? notes.join(' · ') : null);
    })();
  }, [launchFiles, ready, open]);

  if (!project) return null; // reading storage takes a moment on launch

  return (
    <>
      {/* The editor stays mounted under the gallery, so going back to it is instant. */}
      <EditorScreen
        key={project.key}
        project={project}
        debug={debug}
        engine={getEngine}
        onSession={onSession}
        flush={flush}
        onNotice={setNotice}
        onSaved={onSaved}
        onInstall={route === 'installed' ? undefined : showCoach}
        onUpdate={updateReady ? restart : undefined}
        onGallery={() => void openGallery(false)}
        onNewCanvas={() => void openGallery(true)}
      />
      {gallery.open && (
        <GalleryScreen
          current={{ id: project.id, thumbnail: gallery.thumbnail, size: project.size }}
          startNew={gallery.startNew}
          onOpenCurrent={() => setGallery({ open: false })}
          onOpen={(id) => void open(id)}
          onCreate={(size) => {
            setProject(newProject(size));
            setGallery({ open: false });
          }}
          onDelete={async (id) => {
            if (id !== project.id) return;
            // Deleting the open artwork: stop saving it, and leave a fresh canvas behind.
            await session.current?.saver.discard();
            setProject(newProject(project.size));
            setGallery((g) => (g.open ? { ...g, thumbnail: null } : g));
          }}
          onRenamed={(id, name) => id === project.id && setProject({ ...project, name })}
          onNotice={setNotice}
          onInstall={route === 'prompt' || route === 'ios' ? showCoach : undefined}
        />
      )}
      {coach && (
        <InstallCoach
          route={route}
          onClose={() => {
            setCoach(false);
            toolStore.getState().setPrefs({ installCoachSeen: true });
          }}
        />
      )}
      {notice && <Toast message={notice} onDone={clearNotice} />}
      <UpdatePrompt
        askUpdate={!updateSnoozed && (gallery.open || savedSinceUpdate)}
        onRestart={restart}
        onLater={() => setUpdateSnoozed(true)}
      />
      {debug && <DebugHud />}
    </>
  );
}
