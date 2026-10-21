/**
 * Bundle budget (ROADMAP §7.1): the JavaScript needed to start the app must stay under 250 KB
 * gzipped. Counts the entry script and the chunks index.html preloads; chunks loaded on demand
 * (the lab, the PSD worker) don't delay startup and are listed separately.
 *
 *   ./scripts/dnpm run size     (builds first)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 250;
const DIST = 'dist';

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const startup = new Set<string>();
for (const [, attrs = ''] of html.matchAll(/<(?:script|link)\b([^>]*)>/g)) {
  const isModule = /type="module"/.test(attrs) || /rel="modulepreload"/.test(attrs);
  const url = /(?:src|href)="([^"]+\.js)"/.exec(attrs)?.[1];
  if (isModule && url) startup.add(url.replace(/^\.?\//, ''));
}
if (startup.size === 0) throw new Error('No module scripts found in dist/index.html');

const gz = (file: string) => gzipSync(readFileSync(join(DIST, file)), { level: 9 }).length;
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

const assets = readdirSync(join(DIST, 'assets'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => `assets/${f}`);
let total = 0;
console.log('Startup JavaScript (gzipped):');
for (const file of startup) {
  const size = gz(file);
  total += size;
  console.log(`  ${file.padEnd(48)} ${kb(size).padStart(10)}`);
}
console.log('Loaded on demand:');
for (const file of assets.filter((f) => !startup.has(f))) {
  console.log(
    `  ${file.padEnd(48)} ${kb(gz(file)).padStart(10)}  (raw ${kb(statSync(join(DIST, file)).size)})`,
  );
}
const ok = total <= BUDGET_KB * 1024;
console.log(
  `\nStartup total ${kb(total)} of ${BUDGET_KB} KB: ${ok ? 'within budget' : 'OVER BUDGET'}`,
);
if (!ok) process.exit(1);
