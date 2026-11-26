import { z } from 'zod';

// Valida las variables de entorno al arrancar: si falta algo, la API no inicia.
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.url(),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    // Intentos por minuto y por IP en registro y login. Solo se sube para pruebas.
    AUTH_THROTTLE_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
    // Peticiones por minuto y por IP en el resto de rutas.
    THROTTLE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(120),
    // El equipo debe entrar con verificación en dos pasos para usar el panel.
    // Solo se apaga en pruebas o en desarrollo.
    STAFF_2FA_REQUIRED: z
      .enum(['true', 'false'], 'STAFF_2FA_REQUIRED debe ser true o false')
      .default('true')
      .transform((v) => v === 'true'),
    // Clave para cifrar los secretos de 2FA en la base. Si falta, se deriva de
    // JWT_ACCESS_SECRET (cambiar ese secreto obligaría a configurar 2FA de nuevo).
    TOTP_ENCRYPTION_KEY: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z
        .string()
        .min(32, 'TOTP_ENCRYPTION_KEY debe tener al menos 32 caracteres')
        .optional(),
    ),
    // Secreto compartido con la web para aceptar la IP real que reenvía.
    // Vacío equivale a no configurado.
    WEB_PROXY_SECRET: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z
        .string()
        .min(32, 'WEB_PROXY_SECRET debe tener al menos 32 caracteres')
        .optional(),
    ),
    // Correos al cliente. "log" los escribe en el registro (desarrollo);
    // "resend" los envía con la API de Resend y exige RESEND_API_KEY.
    EMAIL_PROVIDER: z.enum(['log', 'resend']).default('log'),
    RESEND_API_KEY: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().min(10).optional(),
    ),
    EMAIL_FROM: z.string().min(3).default('Petbf <no-responder@petbf.local>'),
    // Dirección pública de la tienda, para los enlaces de los correos.
    WEB_URL: z.url().default('http://localhost:3000'),
  })
  .refine((env) => env.EMAIL_PROVIDER !== 'resend' || env.RESEND_API_KEY, {
    message: 'EMAIL_PROVIDER=resend necesita RESEND_API_KEY',
    path: ['RESEND_API_KEY'],
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return result.data;
}
