import { defineConfig, devices } from '@playwright/test';

// Pruebas de navegador de cliente y panel. Necesitan la API y la web
// compiladas (pnpm build) y una base con el seed de ejemplo:
//   SEED_DEMO=true pnpm db:seed
// Usuario admin del seed: E2E_ADMIN_EMAIL y E2E_ADMIN_PASSWORD.
const isCI = Boolean(process.env.CI);
// Mismo secreto en API y web: así las pruebas pasan por el reenvío de la IP real.
const WEB_PROXY_SECRET = 'secreto-de-pruebas-para-reenviar-la-ip-0123';

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
      // Todas las peticiones de la web llegan desde la misma IP (el servidor de Next).
      env: { PORT: '3001', AUTH_THROTTLE_LIMIT: '1000', THROTTLE_LIMIT: '100000', WEB_PROXY_SECRET },
    },
    {
      command: 'pnpm start',
      url: 'http://localhost:3000',
      env: { WEB_PROXY_SECRET },
      reuseExistingServer: !isCI,
    },
  ],
});
