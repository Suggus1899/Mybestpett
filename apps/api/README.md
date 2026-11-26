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
  restringe con `@Roles([...])`: basta uno de los roles, y `ADMIN` siempre pasa.
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
| PUT | /v1/users/:id/roles | ADMIN |
| PATCH | /v1/users/:id/status | ADMIN |
| GET | /v1/categories, /v1/brands | público |
| GET | /v1/products, /v1/products/:slug | público (sin cantidades de stock) |
| GET | /v1/animals, /v1/animals/:slug | público |
| GET | /v1/exchange-rates/current | público |
| GET | /v1/exchange-rates | ORDERS_OPERATOR |
| POST | /v1/exchange-rates | ADMIN (tasa BCV del día) |
| GET, POST, PATCH, PUT | /v1/manage/products, /variants, /categories, /brands | CATALOG_MANAGER |
| POST, PATCH | /v1/manage/animals | CATALOG_MANAGER (venta), ADOPTION_COORDINATOR (adopción) |
| GET | /v1/manage/inventory, /v1/manage/inventory/summary | CATALOG_MANAGER, ORDERS_OPERATOR |
| GET | /v1/shipping-zones, /v1/payment-methods | público (solo activos) |
| GET, POST, PATCH | /v1/manage/shipping-zones, /v1/manage/payment-methods | ADMIN |
| GET, POST, PATCH, DELETE | /v1/addresses | con sesión (las propias) |
| GET, POST, PUT, DELETE | /v1/cart, /v1/cart/items/:variantId | con sesión |
| POST | /v1/orders | con sesión (checkout) |
| GET | /v1/orders, /v1/orders/:id | con sesión (los propios) |
| POST | /v1/orders/:id/cancel | con sesión (antes de reportar el pago) |
| POST | /v1/orders/:id/payments | con sesión (reportar el pago) |
| GET | /v1/manage/orders, /v1/manage/orders/:id | ORDERS_OPERATOR |
| POST | /v1/manage/orders/:id/status, /v1/manage/orders/:id/cancel | ORDERS_OPERATOR |
| GET | /v1/manage/payments | ORDERS_OPERATOR (cola de pagos reportados) |
| POST | /v1/manage/payments/:id/verify, /v1/manage/payments/:id/reject | ORDERS_OPERATOR |

`ADMIN` pasa todas las comprobaciones de rol.

## Reglas de validación que conviene recordar

- Los esquemas de edición no tienen valores por defecto: si los tuvieran, un PATCH
  parcial pisaría campos que no se enviaron (pasó con el stock y está cubierto por pruebas).
- Zod descarta los campos desconocidos: un cliente no puede colarse `roles` o `isActive`.
- Precios en céntimos enteros; imágenes solo `https`; tasas como texto decimal.

## Flujo de compra

1. El cliente arma el carrito (precio siempre actual) y hace el checkout con
   dirección, zona de envío, método de pago y aceptación de términos.
2. En una sola transacción la API revalida stock y precios, congela la tasa BCV,
   descuenta el stock con un `UPDATE` condicionado (`stock >= cantidad`), copia
   nombre, SKU y precio de cada línea, y crea el pedido en `PENDING_PAYMENT`
   con 2 horas para reportar el pago.
3. El cliente reporta referencia, monto y fecha: `PAYMENT_REPORTED`.
4. El operador verifica contra el banco (`PAID`) o rechaza con motivo; al
   rechazar, el pedido vuelve a `PENDING_PAYMENT` con otras 2 horas.
5. `PAID` → `PREPARING` → `SHIPPED` (con número de guía) → `DELIVERED`.

Reglas: una referencia verificada no paga dos pedidos con el mismo método
(índice único parcial en la base); nadie revisa el pago de su propio pedido;
cada minuto se cancelan los pedidos vencidos sin reporte y el stock vuelve;
cada cambio de stock deja un registro en `inventory_movements`.
