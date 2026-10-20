/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { remoteLog } from './tools/vite-plugin-remote-log.ts';

// HTTPS=1 serves a self-signed cert on all interfaces, for LAN testing on tablets.
// Pointer Events work over it, but iOS refuses service workers on untrusted certs:
// use a tunnel for install/offline testing (see README).
const https = process.env.HTTPS === '1';

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
  server: { host: https || undefined },
  preview: { host: https || undefined },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
