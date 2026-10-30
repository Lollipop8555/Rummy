import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// 本地与自定义域名默认走根路径 `/`。
// GitHub Pages 的子路径（`/repo/`）由 CI 通过 VITE_BASE 注入，
// 见 .github/workflows/deploy.yml——不要为部署方便而污染本地开发体验。
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    // 体积预算见 docs/技术方案.md：主包 gzip < 100 KB
    chunkSizeWarningLimit: 400 * 1024,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
