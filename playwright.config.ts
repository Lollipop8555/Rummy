import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 配置。
 *
 * 三个工程对应三种视口预设（手机竖屏 / 手机横屏 / 桌面），
 * 覆盖「同一套 UI 在不同宽高比下是否都可用」这一核心风险。
 *
 * baseURL 与 vite.config.ts 的 base 保持一致（本地默认 `/`），
 * 若两者不一致，所有用例都会 404，这是本项目最容易踩的配置坑。
 */
const PORT = 4173;
const BASE_PATH = '/';

export default defineConfig({
  testDir: './e2e',
  // 不并行：对局用例依赖真实计时（AI 有 2 秒思考延迟），
  // 多 worker 同时跑会让 CPU 争抢导致等待临界，产生随机失败。
  fullyParallel: false,
  // 同一文件内串行，避免共享 webServer 时的资源竞争
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'phone-portrait',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: false,
        hasTouch: true,
      },
    },
    {
      name: 'phone-landscape',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 844, height: 390 },
        hasTouch: true,
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  webServer: {
    // 用 preview 而非 dev：验证的是真实构建产物。
    // 必须显式 --host 127.0.0.1：Vite 默认只绑 localhost，
    // 在 macOS 上会解析到 ::1，而 Playwright 用 127.0.0.1 探测会一直连不上。
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}${BASE_PATH}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
