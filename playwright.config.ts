import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

/** End-to-end smoke tests against the production build, served the way GitHub Pages serves it (static files). */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', grepInvert: /@phone/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'phone', grep: /@phone/, use: { ...devices['Pixel 7'], viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
