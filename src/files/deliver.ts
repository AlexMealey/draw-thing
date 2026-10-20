/** File System Access API (Chromium); not in TypeScript's DOM library. */
interface SaveFilePicker {
  showSaveFilePicker?: (opts: {
    suggestedName: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

export type Delivery = 'saved' | 'cancelled' | 'needs-tap';

/**
 * Hands an exported file to the user (ROADMAP §6.1):
 *
 * - **Windows/Chromium:** the system Save dialog (`showSaveFilePicker`).
 * - **iPad/iPhone:** the share sheet (Save to Files, Photos, AirDrop, other apps).
 * - **Otherwise:** a plain download.
 *
 * Both dialogs need a recent tap. After a slow export that may have expired: the result is then
 * 'needs-tap', and the caller offers a button that calls this again.
 */
export async function deliver(blob: Blob, filename: string): Promise<Delivery> {
  const picker = (window as SaveFilePicker).showSaveFilePicker;
  const ext = filename.slice(filename.lastIndexOf('.'));
  try {
    if (picker) {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: ext.slice(1).toUpperCase(), accept: { [mimeOf(blob)]: [ext] } }],
      });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      return 'saved';
    }
    const file = new File([blob], filename, { type: blob.type });
    if (prefersShare() && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return 'saved';
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    if (err instanceof DOMException && err.name === 'NotAllowedError') return 'needs-tap';
    throw err;
  }
  download(blob, filename);
  return 'saved';
}

function mimeOf(blob: Blob): string {
  return blob.type && /^[\w.+-]+\/[\w.+-]+$/.test(blob.type)
    ? blob.type
    : 'application/octet-stream';
}

/** Touch devices without a save dialog: the share sheet is how files are saved there. */
function prefersShare(): boolean {
  return typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A file name from an artwork name: no path or reserved characters. */
export function fileName(name: string, ext: string): string {
  const printable = [...name].map((c) => (c < ' ' ? ' ' : c)).join('');
  const base =
    printable
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .trim()
      .slice(0, 100) || 'Artwork';
  return `${base}.${ext}`;
}

/** Opens the system file chooser. Must be called from a tap/click handler. */
export function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}
