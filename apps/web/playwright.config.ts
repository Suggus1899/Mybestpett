import { defineConfig, devices } from '@playwright/test';

// Pruebas de navegador de cliente y panel. Necesitan la API y la web
// compiladas (pnpm build) y una base con el seed de ejemplo:
//   SEED_DEMO=true pnpm db:seed
// Usuario admin del seed: E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD.
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  // Comparten la misma base de datos: una prueba a la vez.
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'off',
    locale: 'es-VE',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../api',
      url: 'http://localhost:3001/v1/health',
      reuseExistingServer: !isCI,
      env: { PORT: '3001', AUTH_THROTTLE_LIMIT: '200' },
    },
    {
      command: 'pnpm start',
      url: 'http://localhost:3000',
      reuseExistingServer: !isCI,
    },
  ],
});
