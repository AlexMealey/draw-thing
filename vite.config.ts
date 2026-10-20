/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { remoteLog } from './tools/vite-plugin-remote-log.ts';

// All of these are set by compose.yaml; the defaults suit running Vite directly.
const env = process.env;
// HTTPS=1 serves a self-signed cert, for pen testing over the LAN. iOS refuses service
// workers on untrusted certs: test install/offline with the LAN deployment (see README).
const https = env.HTTPS === '1';
// The dev image sets VITE_HOST=0.0.0.0 so the server is reachable from outside the container.
const host = env.VITE_HOST || https || undefined;
// Extra Host names to accept (e.g. a tunnel), comma-separated, or "all".
const allowedHosts =
  env.VITE_ALLOWED_HOSTS === 'all' ? true : env.VITE_ALLOWED_HOSTS?.split(',').filter(Boolean);
// Polling is only needed when the source lives on a filesystem without inotify events
// (e.g. a Windows drive bind-mounted into a container).
const watch = env.VITE_USE_POLLING === '1' ? { usePolling: true, interval: 300 } : undefined;

export default defineConfig({
  plugins: [
    react(),
    https && basicSsl(),
    remoteLog(),
    VitePWA({
      registerType: 'prompt', // never reload under the user mid-stroke
      injectRegister: false, // registered from React via virtual:pwa-register/react
      pwaAssets: { config: true, overrideManifestIcons: true },
      manifest: {
        id: '/',
        name: 'DrawThing',
        short_name: 'DrawThing',
        description: 'A fast, pen-first drawing app for iPad and Windows tablets.',
        start_url: '/?source=pwa',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        background_color: '#1c1c1e',
        theme_color: '#1c1c1e',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // iOS fetches launch screens itself when the app is added to the home screen.
        globIgnores: ['**/apple-splash-*.png'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/__/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { host, allowedHosts, watch, strictPort: true },
  preview: { host, allowedHosts, strictPort: true },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
