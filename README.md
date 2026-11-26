# Petbf

Tienda online de productos para mascotas, animales en venta y adopción, para Venezuela.

| Carpeta | Qué es | Stack |
| --- | --- | --- |
| `apps/api` | API REST compartida por web y móvil | NestJS 12, Prisma 7, PostgreSQL 16 |
| `apps/web` | Tienda web (y más adelante el panel de operadores) | Next.js 16, React 19, Tailwind 4 |
| `apps/mobile` | App iOS y Android | Flutter (pendiente) |

## Requisitos

Node 22 o superior, pnpm 10 (`corepack enable`) y Docker para la base de datos local.

## Arrancar todo en local

```bash
pnpm install
pnpm db:up                                   # PostgreSQL en Docker
cp apps/api/.env.example apps/api/.env       # cambia JWT_ACCESS_SECRET
cp apps/web/.env.example apps/web/.env.local
pnpm db:migrate                              # crea las tablas
pnpm db:seed                                 # admin y categorías; SEED_DEMO=true añade ejemplos
pnpm dev                                     # web en :3000, API en :3001
```

## Comandos

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`: en todo el monorepo con Turborepo.
- `pnpm --filter api test:e2e`: pruebas e2e de la API contra una base desechable (ver `apps/api/README.md`).
- `pnpm --filter web test:e2e`: pruebas de navegador (Playwright) de cliente y panel. Necesitan
  `pnpm build` y la base con datos de ejemplo: `SEED_DEMO=true pnpm db:seed`.
- `docker build -f apps/api/Dockerfile -t petbf-api .`: imagen de la API (la etapa `migrate`
  aplica las migraciones).

## Decisiones clave

- Precios en céntimos enteros de USD; Bs y euros se calculan con la tasa del BCV
  y cada pedido guardará la tasa con la que se cobró.
- Comprar exige cuenta. Cada persona puede tener varios roles: `CUSTOMER`, `ADMIN`,
  `ORDERS_OPERATOR`, `CATALOG_MANAGER` y `ADOPTION_COORDINATOR`.
- La web guarda los tokens en cookies httpOnly y nunca los expone al navegador.
- Las acciones sensibles quedan en `audit_logs`.
