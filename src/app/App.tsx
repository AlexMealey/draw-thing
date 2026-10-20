import { useCallback, useRef, useState } from 'react';
import { DebugHud } from '../debug/DebugHud';
import { type Engine, screenDocSize } from '../engine/Engine';
import { historyStore } from '../state/historyStore';
import { EditorScreen } from './editor/EditorScreen';
import { GalleryScreen } from './gallery/GalleryScreen';
import { Toast } from './Toast';
import { UpdatePrompt } from './UpdatePrompt';

interface OpenCanvas {
  /** Changing the key remounts the editor, and with it a fresh engine and document. */
  key: number;
  size: { w: number; h: number };
}

type Gallery = { open: false } | { open: true; startNew: boolean; thumbnail: string | null };

export function App({ debug }: { debug: boolean }) {
  const engineRef = useRef<Engine | null>(null);
  const [canvas, setCanvas] = useState<OpenCanvas>(() => ({ key: 1, size: screenDocSize() }));
  const [gallery, setGallery] = useState<Gallery>({ open: false });
  const [notice, setNotice] = useState<string | null>(null);

  const getEngine = useCallback(() => engineRef.current, []);
  const onEngine = useCallback((engine: Engine | null) => {
    engineRef.current = engine;
  }, []);
  const clearNotice = useCallback(() => setNotice(null), []);

  const openGallery = (startNew: boolean) =>
    setGallery({ open: true, startNew, thumbnail: engineRef.current?.documentThumbnail() ?? null });

  return (
    <>
      {/* The editor stays mounted under the gallery, so "Current canvas" returns to it intact. */}
      <EditorScreen
        key={canvas.key}
        docSize={canvas.size}
        debug={debug}
        engine={getEngine}
        onEngine={onEngine}
        onNotice={setNotice}
        onGallery={() => openGallery(false)}
        onNewCanvas={() => openGallery(true)}
      />
      {gallery.open && (
        <GalleryScreen
          current={{ thumbnail: gallery.thumbnail, size: canvas.size }}
          hasWork={historyStore.getState().canUndo}
          startNew={gallery.startNew}
          onOpenCurrent={() => setGallery({ open: false })}
          onCreate={(size) => {
            setCanvas((c) => ({ key: c.key + 1, size }));
            setGallery({ open: false });
          }}
        />
      )}
      {notice && <Toast message={notice} onDone={clearNotice} />}
      <UpdatePrompt />
      {debug && <DebugHud />}
    </>
  );
}
