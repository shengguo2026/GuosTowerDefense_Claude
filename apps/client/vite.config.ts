import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** In dev mode the game server runs on its own port and Vite forwards API and WebSocket calls to it. */
const serverPort = Number(process.env.GTD_SERVER_PORT ?? 3100);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://127.0.0.1:${serverPort}`,
      '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true },
      '/art': `http://127.0.0.1:${serverPort}`,
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
