import { useEffect, useState } from 'react';
import { currentPlatform, OS_LABEL } from '../platform/env';
import styles from './DebugHud.module.css';

interface PointerStats {
  type: string;
  buttons: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  altitude?: number;
  azimuth?: number;
}

interface Snapshot {
  fps: number;
  worstFrameMs: number;
  eventsPerSec: number;
  /** Including coalesced samples: the real digitizer rate (Apple Pencil ≈ 240/s). */
  samplesPerSec: number;
  pointer: PointerStats | null;
  viewport: string;
  online: boolean;
  swControlled: boolean;
}

type PE = PointerEvent & { altitudeAngle?: number; azimuthAngle?: number };

const deg = (rad: number | undefined) =>
  rad === undefined ? '–' : `${Math.round((rad * 180) / Math.PI)}°`;

function probeCapabilities() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  gl?.getExtension('WEBGL_lose_context')?.loseContext(); // don't hold a context just for the probe
  return {
    webgl2: gl !== null,
    coalesced: 'getCoalescedEvents' in PointerEvent.prototype,
    predicted: 'getPredictedEvents' in PointerEvent.prototype,
  };
}

/** Diagnostics overlay, enabled with ?debug. Samples at 2 Hz so it never competes with drawing. */
export function DebugHud() {
  const [platform] = useState(currentPlatform);
  const [caps] = useState(probeCapabilities);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void navigator.storage?.persisted?.().then((p) => !cancelled && setPersisted(p));

    let frames = 0;
    let events = 0;
    let samples = 0;
    let worst = 0;
    let lastFrame = performance.now();
    let windowStart = lastFrame;
    let pointer: PointerStats | null = null;
    let raf = 0;

    const tick = (now: number) => {
      worst = Math.max(worst, now - lastFrame);
      lastFrame = now;
      frames++;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onPointer = (e: PE) => {
      events++;
      samples += e.getCoalescedEvents?.().length || 1;
      pointer = {
        type: e.pointerType,
        buttons: e.buttons,
        pressure: e.pressure,
        tiltX: e.tiltX,
        tiltY: e.tiltY,
        altitude: e.altitudeAngle,
        azimuth: e.azimuthAngle,
      };
    };
    const listen = { capture: true, passive: true } as const;
    window.addEventListener('pointermove', onPointer, listen);
    window.addEventListener('pointerdown', onPointer, listen);

    const interval = setInterval(() => {
      const now = performance.now();
      const sec = (now - windowStart) / 1000;
      windowStart = now;
      setSnap({
        fps: frames / sec,
        worstFrameMs: worst,
        eventsPerSec: events / sec,
        samplesPerSec: samples / sec,
        pointer,
        viewport: `${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
        online: navigator.onLine,
        swControlled: navigator.serviceWorker?.controller != null,
      });
      frames = events = samples = worst = 0;
    }, 500);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearInterval(interval);
      window.removeEventListener('pointermove', onPointer, listen);
      window.removeEventListener('pointerdown', onPointer, listen);
    };
  }, []);

  const p = snap?.pointer;
  const lines = [
    `${OS_LABEL[platform.os]} · ${platform.standalone ? 'installed' : 'tab'} · ${snap?.viewport ?? ''}`,
    `fps ${snap?.fps.toFixed(0) ?? '–'} · worst frame ${snap?.worstFrameMs.toFixed(1) ?? '–'} ms`,
    `events ${snap?.eventsPerSec.toFixed(0) ?? '–'}/s · samples ${snap?.samplesPerSec.toFixed(0) ?? '–'}/s`,
    p
      ? `${p.type} btn=${p.buttons} p=${p.pressure.toFixed(3)} tilt=${p.tiltX}/${p.tiltY} alt=${deg(p.altitude)} az=${deg(p.azimuth)}`
      : 'pointer –',
    `webgl2 ${caps.webgl2 ? 'yes' : 'NO'} · coalesced ${caps.coalesced ? 'yes' : 'no'} · predicted ${caps.predicted ? 'yes' : 'no'}`,
    `sw ${snap?.swControlled ? 'controlling' : 'none'} · ${snap?.online === false ? 'offline' : 'online'} · storage ${persisted === null ? '?' : persisted ? 'persisted' : 'best-effort'}`,
  ];

  return (
    <pre className={styles.hud} aria-hidden="true">
      {lines.join('\n')}
    </pre>
  );
}
