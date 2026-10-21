import { useEffect, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { parseRecording } from '../engine/input/recording';
import { chooseFile, deliver } from '../files/deliver';
import { currentPlatform, OS_LABEL } from '../platform/env';
import ui from '../app/ui/ui.module.css';

interface Props {
  engine: () => Engine | null;
  onNotice: (message: string) => void;
}

/**
 * Records real pen sessions as JSON for regression replays (ROADMAP §7.1), and plays them back.
 * Save a recording, add it to `e2e/recordings/`, and CI replays it on every run.
 */
export function RecorderControls({ engine, onNotice }: Props) {
  const [count, setCount] = useState<number | null>(() => engine()?.recordedStrokes ?? null);
  const [replaying, setReplaying] = useState(false);
  const recording = count !== null;

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setCount(engine()?.recordedStrokes ?? null), 500);
    return () => clearInterval(id);
  }, [recording, engine]);

  const start = () => {
    const e = engine();
    if (!e) return;
    const p = currentPlatform();
    e.startRecording(
      `${OS_LABEL[p.os]} · ${p.standalone ? 'installed' : 'tab'} · ${navigator.userAgent}`,
    );
    setCount(0);
  };

  const stop = async () => {
    const rec = engine()?.stopRecording() ?? null;
    setCount(null);
    if (!rec || rec.strokes.length === 0) return onNotice('Nothing was recorded');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
    await deliver(blob, `strokes-${stamp}.json`).catch((err: unknown) => {
      console.error(err);
      onNotice('Couldn’t save the recording');
    });
  };

  const replay = async () => {
    const file = await chooseFile('.json,application/json');
    const e = engine();
    if (!file || !e) return;
    try {
      const rec = parseRecording(await file.text());
      if (rec.doc.w !== e.docW || rec.doc.h !== e.docH) {
        onNotice(
          `Recorded on a ${rec.doc.w} × ${rec.doc.h} canvas; replaying at the same positions`,
        );
      }
      setReplaying(true);
      await e.replay(rec, 'recorded');
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setReplaying(false);
    }
  };

  return (
    <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' }}>
      {recording ? (
        <button className={`${ui.textButton} ${ui.primary}`} onClick={() => void stop()}>
          Stop and save ({count} {count === 1 ? 'stroke' : 'strokes'})
        </button>
      ) : (
        <button className={ui.textButton} onClick={start}>
          Record strokes
        </button>
      )}
      <button className={ui.textButton} onClick={() => void replay()} disabled={replaying}>
        {replaying ? 'Replaying…' : 'Replay recording…'}
      </button>
    </p>
  );
}
