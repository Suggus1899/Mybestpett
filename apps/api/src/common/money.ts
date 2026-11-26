import { z } from 'zod';

// Precio en céntimos de USD: 1250 = 12,50 $. Máximo 1.000.000 $.
export const usdCentsSchema = z.number().int().min(0).max(100_000_000);
