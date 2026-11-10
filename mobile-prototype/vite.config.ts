import { defineConfig } from 'vite';

// base './' so the build works from any sub-path (preview hosts, GitHub Pages, file servers).
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
  server: {
    // Optional: run the existing weather server (server/ub6server) on :8080 and it is used via /v1/world.
    proxy: { '/v1': { target: 'http://localhost:8080', changeOrigin: true } },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
