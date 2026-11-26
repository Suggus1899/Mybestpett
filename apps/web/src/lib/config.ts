// Constantes compartidas por el proxy y el código de servidor. No son secretas.
export const API_URL = process.env.API_URL ?? 'http://localhost:3001/v1';

export const ACCESS_COOKIE = 'petbf_at';
export const REFRESH_COOKIE = 'petbf_rt';
// Token intermedio entre la contraseña y el código de 2FA (5 minutos).
export const CHALLENGE_COOKIE = 'petbf_2fa';
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30; // igual que REFRESH_TOKEN_TTL_DAYS de la API
