import type { Connect, Plugin } from 'vite';

/**
 * Accepts console output POSTed by src/debug/remoteLog.ts and prints it in the terminal,
 * so tablets can be debugged without Safari Web Inspector (which needs a Mac).
 * Mounted on both the dev and preview servers.
 */
export function remoteLog(): Plugin {
  return {
    name: 'draw-thing:remote-log',
    configureServer(server) {
      server.middlewares.use('/__log', handler());
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__log', handler());
    },
  };
}

const MAX_BODY = 512 * 1024;
const RESET = '\x1b[0m';
const COLORS: Record<string, string> = {
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  debug: '\x1b[90m',
};

interface Entry {
  level: string;
  t: number;
  msg: string;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.level === 'string' && typeof e.t === 'number' && typeof e.msg === 'string';
}

function handler(): Connect.NextHandleFunction {
  return (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        res.statusCode = 413;
        res.end();
        req.destroy();
      }
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let entries: unknown;
      try {
        entries = JSON.parse(body);
      } catch {
        entries = null;
      }
      if (!Array.isArray(entries)) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const who = (req.socket.remoteAddress ?? '?').replace(/^::ffff:/, '');
      for (const e of entries.filter(isEntry)) {
        const color = COLORS[e.level] ?? '';
        const time = (e.t / 1000).toFixed(1);
        process.stdout.write(`${color}[${who} +${time}s] ${e.level}: ${e.msg}${RESET}\n`);
      }
      res.statusCode = 204;
      res.end();
    });
  };
}
