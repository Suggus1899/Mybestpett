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

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
