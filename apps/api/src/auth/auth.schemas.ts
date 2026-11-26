import { z } from 'zod';

// Se limpia antes de validar: los teclados del móvil suelen añadir un espacio.
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Correo inválido').max(254));

// Máximo 128 para que nadie envíe contraseñas enormes y fuerce un hash costoso.
const password = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128);

const name = z.string().trim().min(1).max(80);

// Formato venezolano flexible: +58 412 1234567, 0412-1234567, etc.
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{10,16}$/, 'Teléfono inválido');

export const registerSchema = z.object({
  email,
  password,
  firstName: name,
  lastName: name,
  phone: phoneSchema.optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(200),
});

// Código de 6 dígitos de la app, o uno de recuperación (XXXX-XXXX).
const code = z
  .string('Escribe el código')
  .trim()
  .regex(/^(\d{3}\s?\d{3}|[A-Za-z2-7]{4}-?[A-Za-z2-7]{4})$/, 'Código inválido');

export const enableTwoFactorSchema = z.object({
  code: z
    .string('Escribe el código')
    .trim()
    .regex(/^\d{3}\s?\d{3}$/, 'Escribe los 6 dígitos de tu app'),
});

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1, 'Escribe tu contraseña').max(128),
  code,
});

export const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1).max(1000),
  code,
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
export type EnableTwoFactorDto = z.infer<typeof enableTwoFactorSchema>;
export type DisableTwoFactorDto = z.infer<typeof disableTwoFactorSchema>;
export type TwoFactorLoginDto = z.infer<typeof twoFactorLoginSchema>;
