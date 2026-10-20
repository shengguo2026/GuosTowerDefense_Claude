import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.GTD_E2E_PORT ?? 4317);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/e2e',
  // All tests share one game server and one save, so they run one after another.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      // The game is local only: a proxy from the environment would stand between the PC and a joining tablet.
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !/proxy/i.test(name))),
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
        : {}),
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 820 }, hasTouch: true },
    },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 844, height: 390 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: 'npm run build && node tools/e2e-server.mjs',
    url: `http://127.0.0.1:${port}/api/health`,
    env: { GTD_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
