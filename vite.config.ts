import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      // Ask before activating updates so a teacher's register is not
      // unexpectedly interrupted by an automatic page reload.
      registerType: 'prompt',

      // The React status component handles service worker registration.
      injectRegister: false,

      manifest: {
        name: 'Neera — Another Chance to Learn',
        short_name: 'Neera',
        description: 'Simple teacher-operated school attendance.',
        theme_color: '#183c32',
        background_color: '#f6f7f2',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/neera-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },

      workbox: {
        // Cache the built app files so navigation works without internet.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: 'index.html',

        // Remove obsolete application caches after an update.
        // This does not clear attendance stored in localStorage.
        cleanupOutdatedCaches: true,

        // Keep updates waiting until the teacher chooses to reload.
        skipWaiting: false,
        clientsClaim: true,
      },

      // Test offline loading using the production build and preview server.
      // Keeping this disabled avoids caching development-server files.
      devOptions: {
        enabled: false,
      },
    }),
  ],
})