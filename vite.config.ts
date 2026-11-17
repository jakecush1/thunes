import { defineConfig } from 'vitest/config';
import { thunesAssets } from './scripts/vite/thunes-assets.ts';

export default defineConfig({
  plugins: [thunesAssets()],
  server: { host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
