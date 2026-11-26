# API de Petbf

NestJS 12 (ESM) + Prisma 7 + PostgreSQL. Todas las rutas cuelgan de `/v1`.

## Arrancar en local

```bash
cp .env.example .env          # y cambia JWT_ACCESS_SECRET
pnpm db:up                    # desde la raíz: PostgreSQL en Docker
pnpm prisma:migrate           # aplica migraciones y crea las nuevas
pnpm prisma:seed              # admin (SEED_ADMIN_*) y categorías base
pnpm start:dev                # http://localhost:3001/v1/health
```

## Pruebas

```bash
pnpm test                     # unitarias
cp .env.test.example .env.test
DATABASE_URL=<la de .env.test> pnpm prisma:deploy
pnpm test:e2e                 # usa una base desechable: la vacía en cada prueba
```

## Cómo está organizada

- `src/config/env.ts`: valida las variables de entorno con Zod al arrancar.
- `src/auth`: registro, login, refresh y logout. Access token JWT de 15 min y
  refresh token opaco rotativo guardado como hash en `sessions`.
- Guards globales, en este orden: límite de peticiones, sesión (`JwtAuthGuard`)
  y rol (`RolesGuard`). Una ruta es privada salvo que lleve `@Public()`; se
  restringe por rol con `@Roles(['ADMIN'])`.
- `src/users`: gestión de cuentas, solo para `ADMIN`.
- `src/audit`: `AuditService.record()` deja constancia de acciones sensibles.

## Endpoints actuales

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | /v1/health | público |
| POST | /v1/auth/register | público |
| POST | /v1/auth/login | público |
| POST | /v1/auth/refresh | público (con refresh token) |
| POST | /v1/auth/logout | público (con refresh token) |
| GET | /v1/auth/me | con sesión |
| GET | /v1/users | ADMIN |
| PATCH | /v1/users/:id/role | ADMIN |
| PATCH | /v1/users/:id/status | ADMIN |
