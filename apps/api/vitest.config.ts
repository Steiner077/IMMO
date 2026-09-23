import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { env: { JWT_SECRET: 'unit-test-secret-unit-test-secret-unit' }, include: ['test/**/*.test.ts', 'src/**/*.test.ts'], exclude: ['test/integration/**', 'node_modules/**'] } });
