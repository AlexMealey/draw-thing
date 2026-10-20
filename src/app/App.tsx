import { useCallback, useEffect, useRef, useState } from 'react';
import { DebugHud } from '../debug/DebugHud';
import { screenDocSize } from '../engine/limits';
import { setLastOpen } from '../persistence/projects';
import { EditorScreen } from './editor/EditorScreen';
import { GalleryScreen } from './gallery/GalleryScreen';
import { newProject, openLast, type OpenProject, openProject, type Session } from './project';
import { Toast } from './Toast';
import { UpdatePrompt } from './UpdatePrompt';

type Gallery = { open: false } | { open: true; startNew: boolean; thumbnail: string | null };

export function App({ debug }: { debug: boolean }) {
  const session = useRef<Session | null>(null);
  const [project, setProject] = useState<OpenProject | null>(null);
  const [gallery, setGallery] = useState<Gallery>({ open: false });
  const [notice, setNotice] = useState<string | null>(null);

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

  const openGallery = async (startNew: boolean) => {
    const thumbnail = session.current?.engine.documentThumbnail() ?? null;
    await flush(); // so the gallery shows the latest state
    setGallery({ open: true, startNew, thumbnail });
  };

  const open = async (id: string) => {
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
  };

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
        />
      )}
      {notice && <Toast message={notice} onDone={clearNotice} />}
      <UpdatePrompt />
      {debug && <DebugHud />}
    </>
  );
}
