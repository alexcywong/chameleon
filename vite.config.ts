import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': {
        // WS_PORT lets dev/tests avoid collisions with other apps on 3000
        target: `ws://localhost:${process.env.WS_PORT || 3000}`,
        ws: true,
      },
    },
  },
  define: {
    // VITE_USE_LOCAL=true for bot-only demo; empty/undefined for WS multiplayer
    'import.meta.env.VITE_USE_LOCAL': JSON.stringify(process.env.VITE_USE_LOCAL || ''),
    '__BUILD_DATE__': JSON.stringify(new Date().toISOString()),
  },
})
