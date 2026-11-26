import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Las e2e usan .env.test (copia de .env.test.example) o las variables del entorno (CI).
const fileEnv = existsSync('.env.test') ? parse(readFileSync('.env.test')) : {};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // La verificación en dos pasos del equipo se prueba en su propio archivo.
    env: { ...fileEnv, NODE_ENV: 'test', STAFF_2FA_REQUIRED: 'false' },
    // Comparten una base de datos: un archivo a la vez.
    fileParallelism: false,
  },
});
