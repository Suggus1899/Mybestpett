import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestMeta } from './auth.types.js';

// IP y navegador de la petición, para sesiones y auditoría.
export const ReqMeta = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestMeta => {
    const request = context.switchToHttp().getRequest<Request>();
    const userAgent = request.headers['user-agent'];
    return {
      ip: request.ip ?? null,
      userAgent: userAgent ? userAgent.slice(0, 255) : null,
    };
  },
);
