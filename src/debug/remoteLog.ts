const LEVELS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type Level = (typeof LEVELS)[number];

export interface LogEntry {
  level: Level;
  /** ms since page load */
  t: number;
  msg: string;
}

const MAX_ARG_LENGTH = 2000;
const MAX_QUEUE = 1000;
const BATCH = 200;

const truncate = (s: string) =>
  s.length > MAX_ARG_LENGTH ? `${s.slice(0, MAX_ARG_LENGTH)}… (+${s.length - MAX_ARG_LENGTH})` : s;

/** Turns any console argument into a bounded, readable string. Never throws. */
export function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return truncate(arg);
  if (arg instanceof Error) return truncate(arg.stack ?? `${arg.name}: ${arg.message}`);
  if (typeof arg === 'function') return `[Function ${arg.name || 'anonymous'}]`;
  if (typeof arg !== 'object' || arg === null) return String(arg);
  if (typeof Element !== 'undefined' && arg instanceof Element) {
    return `<${arg.tagName.toLowerCase()}${arg.id ? `#${arg.id}` : ''}>`;
  }
  if (typeof Event !== 'undefined' && arg instanceof Event) {
    return `[${arg.constructor.name} ${arg.type}]`;
  }
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(arg, (_key, value: unknown) => {
      if (typeof value === 'bigint') return `${value}n`;
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Seen]'; // cycle or shared reference
        seen.add(value);
      }
      return value;
    });
    return truncate(json ?? String(arg));
  } catch {
    return Object.prototype.toString.call(arg);
  }
}

/**
 * Mirrors console output and uncaught errors to the dev/preview server (tools/vite-plugin-remote-log.ts).
 * Batched, bounded, and silent on failure; stops for good if the endpoint doesn't exist.
 */
export function installRemoteLog(endpoint = '/__log') {
  const queue: LogEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disabled = false;

  const flush = () => {
    timer = undefined;
    if (disabled || queue.length === 0) return;
    const body = JSON.stringify(queue.splice(0, BATCH));
    fetch(endpoint, { method: 'POST', body, headers: { 'content-type': 'application/json' } })
      .then((res) => {
        if (res.status === 404 || res.status === 405)
          disabled = true; // static host: no endpoint
        else if (queue.length > 0) schedule();
      })
      .catch(() => {
        // Offline or server gone: drop this batch, keep trying with later ones.
      });
  };
  const schedule = () => {
    timer ??= setTimeout(flush, 250);
  };
  const push = (level: Level, args: readonly unknown[]) => {
    if (disabled) return;
    queue.push({ level, t: Math.round(performance.now()), msg: args.map(serializeArg).join(' ') });
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    schedule();
  };

  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      push(level, args);
    };
  }
  window.addEventListener('error', (e) =>
    push('error', [e.error ?? e.message, `at ${e.filename}:${e.lineno}:${e.colno}`]),
  );
  window.addEventListener('unhandledrejection', (e) =>
    push('error', ['Unhandled rejection:', e.reason]),
  );
  // iOS can kill a backgrounded PWA without warning; get the tail out first.
  window.addEventListener('pagehide', () => {
    if (disabled || queue.length === 0) return;
    const blob = new Blob([JSON.stringify(queue.splice(0, BATCH))], { type: 'application/json' });
    navigator.sendBeacon(endpoint, blob);
  });

  push('info', [`remote log attached: ${navigator.userAgent}`]);
}
