# Stroke recordings

Pen sessions saved with the stroke recorder (`?debug` → Actions → Diagnostics → Record strokes, or
the `?lab` page). Every `.json` file here is replayed by `e2e/replay.spec.ts` and compared with
`e2e/snapshots/replay.spec.ts/recording-<name>.png`.

To add one, copy the file here and run `./scripts/e2e replay --update-snapshots=missing`, check the
new image, and commit both. See [docs/QA.md](../../docs/QA.md).

`cdp-pen-sample.json` was recorded from Chromium's synthetic pen input. Recordings from a real
Pencil or Surface Pen are more valuable: add them as they're made.
