import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        globIgnores: ['tesseract/**'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && /^\/(?:tesseract|tessdata)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets-v1',
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
