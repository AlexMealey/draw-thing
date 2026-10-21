import { lazy } from 'react';

/** The lab page, loaded only when asked for (?lab): it stays out of the app's bundle. */
export const LazyLab = lazy(() => import('./Lab').then((m) => ({ default: m.Lab })));
