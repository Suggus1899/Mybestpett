import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '../generated/prisma/client.js';

// Traduce los errores conocidos de Prisma a respuestas HTTP claras, para no
// repetir try/catch en cada servicio. El resto sigue el manejo normal de Nest.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter
  extends BaseExceptionFilter
  implements ExceptionFilter
{
  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const mapped = this.map(error);
    super.catch(mapped ?? error, host);
  }

  private map(
    error: Prisma.PrismaClientKnownRequestError,
  ): HttpException | null {
    switch (error.code) {
      case 'P2002':
        return new ConflictException(
          'Ya existe un registro con ese valor único',
        );
      case 'P2003':
        return new BadRequestException(
          'Hace referencia a un registro que no existe',
        );
      case 'P2025':
        return new NotFoundException('Registro no encontrado');
      default:
        return null;
    }
  }
}
