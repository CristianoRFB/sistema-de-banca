import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    // Keep browser requests same-origin in local development; the Worker runs on Wrangler's default port.
    proxy: { '/api': 'http://localhost:8787' },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/banca-mark.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-icon.png'],
      manifest: {
        name: 'Banca Ana Maria',
        short_name: 'Ana Maria',
        description: 'Catálogo e reservas da Banca Ana Maria, em Santa Fé do Sul.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f5f3ec',
        theme_color: '#b8ed57',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{css,html,svg,webmanifest}'],
        globIgnores: [
          'tesseract/**',
          'assets/exceljs*.js',
          'assets/pdf-*.js',
          'assets/jspdf*.js',
          'assets/html2canvas*.js',
          'assets/index.es-*.js',
          'assets/purify.es-*.js',
        ],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Vite/Rolldown hashes make these URLs immutable and safe to cache at runtime.
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|mjs)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-script-assets-v1',
              expiration: { maxEntries: 100, maxAgeSeconds: 31_536_000 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && /^\/(?:tesseract|tessdata)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              // Bump this version when replacing assets at the stable OCR URLs below.
              cacheName: 'ocr-assets-v2',
              expiration: { maxEntries: 8, maxAgeSeconds: 31_536_000 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react')) return 'react-vendor';
          if (id.includes('node_modules/firebase')) return 'firebase-vendor';
        },
      },
    },
  },
});
