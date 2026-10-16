import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Mercheck',
        short_name: 'Mercheck',
        description: 'Mobile-first shopping list app',
        theme_color: '#100c05',
        // Matches the app icon's own backdrop so the splash screen is seamless.
        background_color: '#e2b53c',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // The API is always live: never answer it from the offline cache.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  // `npm run dev` talks to a locally running server (see server/).
  server: {
    proxy: { '/api': 'http://localhost:4480' },
  },
});
