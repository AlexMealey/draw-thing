export const percent = (v: number) => `${Math.round(v * 100)}%`;

/** 1536 → "1.5 KB", in powers of 1024 like the OS shows storage. */
export function fileSize(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
