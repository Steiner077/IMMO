import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  // Das gemeinsame Paket wird in das Bundle aufgenommen
  noExternal: ['@immo/shared'],
});
