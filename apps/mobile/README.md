# Petbf móvil (Flutter)

App de cliente para iOS y Android. Usa la misma API que la web (`/v1`) y las
mismas reglas: precios en dólares con su equivalente en bolívares a la tasa
BCV, compra solo con cuenta, pago reportado y verificado por el equipo.

## Qué hace

| Pantalla | Detalle |
|----------|---------|
| Inicio | Buscador, ofertas, tasa BCV del día, especies, novedades y animales que buscan hogar |
| Tienda | Búsqueda (2 a 80 letras), filtros por categoría, especie y ofertas, orden, scroll infinito, estrellas en cada tarjeta |
| Producto | Galería, presentaciones, existencia, cantidad (máx. 20), si admite devolución, valoración, reseñas y "También te puede gustar" |
| Reseñas | Promedio y distribución, orden (recientes, mejores, peores), 10 por página; quien recibió el producto escribe, edita o borra la suya (1 a 5 estrellas, título opcional de 80, texto de 10 a 1000) y ve si el equipo la ocultó |
| Animales | Venta y adopción por separado, solo las especies que la tienda acepta, ficha con edad, vacunas y esterilización |
| Carrito | Cambiar cantidades, avisos de stock, envío gratis desde 25 $ |
| Checkout | Dirección (o crear una), zonas que llegan a ese estado, método de pago con el monto estimado en su moneda, términos |
| Pedido | Instrucciones de pago, plazo de 2 horas con cuenta regresiva, reportar pago con comprobante (JPG, PNG, WebP o PDF de hasta 5 MB), cancelar, guía de envío e historial |
| Devoluciones | Hasta 3 días después de la entrega, por unidades y con motivo; alimento e higiene quedan fuera; estado y reembolso en el pedido |
| Cuenta | Entrar, crear cuenta, direcciones (máx. 10) y cerrar sesión |

La solicitud de adopción todavía no tiene endpoint en la API; la ficha muestra
la misma nota que la web.

## Arrancar

Requisitos: Flutter 3.50 (Dart 3.14) y la API corriendo (ver el README de la raíz).

```bash
cd apps/mobile
flutter pub get
flutter run                                    # emulador Android o simulador iOS
flutter run --dart-define=API_URL=http://192.168.1.20:3001/v1   # teléfono real en tu red
```

Sin `API_URL`, la app usa `http://10.0.2.2:3001/v1` en el emulador de Android
(es el `localhost` de tu computadora) y `http://localhost:3001/v1` en iOS.
Una compilación de release exige `https`: `flutter build apk --dart-define=API_URL=https://api.ejemplo.com/v1`.

## Arquitectura

```
lib/
├── core/          ← cliente HTTP, sesión, dinero, formatos, validaciones, providers
├── models/        ← lectura estricta del JSON de la API
├── widgets/       ← piezas comunes: precios, tarjetas, rejilla paginada, barra inferior
├── features/      ← pantallas por área: home, catalog, animals, cart, checkout, orders, account
├── router.dart    ← rutas y protección de las privadas
└── theme.dart     ← colores y tipografías de Petbf
```

| Decisión | Por qué |
|----------|---------|
| Riverpod 3 | Estado por pantalla con recarga y reintento; los providers se sustituyen en las pruebas |
| go_router con `StatefulShellRoute` | Cinco pestañas que conservan su historial; `/checkout`, `/pedidos` y `/cuenta/direcciones` piden entrar y luego vuelven |
| `flutter_secure_storage` | Los tokens van al Keychain (iOS) o al Keystore (Android), nunca a texto plano. Copia de seguridad de Android desactivada |
| Renovación de token en vuelo único | La API rota el refresh token y revoca la sesión si se reutiliza: si varias peticiones reciben 401 a la vez, solo una renueva |
| Dinero en centavos y `BigInt` | Los montos en Bs y € se calculan igual que la API (redondeo a la mitad hacia arriba), sin errores de `double` |
| Hora de Caracas fija (UTC-4) | Venezuela no cambia de horario; fechas y plazos se ven igual en cualquier teléfono |
| El comprobante se valida por su contenido | Igual que la API: se leen los primeros bytes, no la extensión, y se rechaza antes de subir si pesa más de 5 MB |
| Fuentes incluidas | Fredoka y Nunito van en `assets/fonts` (licencia OFL), sin descargarlas al abrir |
| Tráfico sin cifrar solo en debug | Android lo permite solo hacia `10.0.2.2` y `localhost`; iOS solo en red local |

Si la API rechaza algo, la app muestra su mensaje (sin el prefijo del campo).
Sin conexión, la sesión guardada no se borra y cada pantalla ofrece reintentar.

## Pruebas

```bash
flutter analyze
flutter test                     # 231 pruebas, sin red
```

- `test/core`: dinero, formatos, validaciones, cliente HTTP (renovación, 401, errores) y lectura del JSON.
- `test/flows`: la app completa en un teléfono de 390×844 sobre una API falsa en memoria
  (`test/support/fake_backend.dart`): entrar, registro, catálogo, carrito, checkout,
  pedidos, reporte de pago, comprobantes, devoluciones, reseñas, recomendados y direcciones, con sus
  validaciones y errores.

Prueba de contrato contra la API real (la corre CI con datos de ejemplo):

```bash
SEED_DEMO=true pnpm --filter api prisma:seed
AUTH_THROTTLE_LIMIT=1000 pnpm --filter api start:prod
CONTRACT_API_URL=http://localhost:3001/v1 flutter test contract
```

Crea una cuenta nueva, compra, reporta el pago, sube y descarga el comprobante,
intenta devolver un pedido sin entregar, cancela un segundo pedido y lee las
reseñas y los recomendados (sin haber recibido el producto, reseñar da 403). También
comprueba que el monto en Bs que calcula la app es el mismo que fija la API.

CI (`.github/workflows/ci.yml`, job `mobile`) corre formato, análisis, pruebas,
contrato y compila un APK de debug que queda como artefacto durante 7 días.
