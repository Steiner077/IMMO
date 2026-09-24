import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Stand der Software (Datum des letzten Updates) – hilft beim Prüfen, ob "git pull" geklappt hat
let version = 'unbekannt';
try {
  version = execSync('git log -1 --format=%cd --date=format:%d.%m.%Y·%H:%M', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().replace('·', ' ');
} catch {
  /* kein git vorhanden */
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false } },
  },
  preview: { port: 5173 },
});
