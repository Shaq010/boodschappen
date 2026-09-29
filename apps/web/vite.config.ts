import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * De frontend praat alleen met de eigen API op /api. Er is GEEN api-key of
 * andere geheim in deze build: de browser krijgt alleen wat `GET /api/config`
 * teruggeeft, en dat bevat per definitie geen geheimen.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Overridable zodat de e2e-tests naast een draaiende dev-server kunnen
    // draaien in plaats van er tegenaan te botsen.
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
