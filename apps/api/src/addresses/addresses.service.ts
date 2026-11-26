import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateAddressDto,
  UpdateAddressDto,
} from './addresses.schemas.js';

export const MAX_ADDRESSES = 10;

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  // La primera dirección queda como predeterminada.
  async create(userId: string, dto: CreateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      if (count >= MAX_ADDRESSES) {
        throw new BadRequestException(
          `Puedes guardar hasta ${MAX_ADDRESSES} direcciones`,
        );
      }
      const isDefault = dto.isDefault || count === 0;
      if (isDefault) await this.clearDefault(tx, userId);
      return tx.address.create({ data: { ...dto, isDefault, userId } });
    });
  }

  async update(userId: string, id: string, dto: UpdateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.findOwn(tx, userId, id);
      if (dto.isDefault) await this.clearDefault(tx, userId);
      // No se puede quitar la predeterminada sin elegir otra.
      const data =
        dto.isDefault === false ? { ...dto, isDefault: undefined } : dto;
      return tx.address.update({ where: { id }, data });
    });
  }

  async remove(userId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const address = await this.findOwn(tx, userId, id);
      await tx.address.delete({ where: { id } });
      if (address.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        });
        if (next) {
          await tx.address.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }
    });
  }

  // Una dirección de otra persona se trata como inexistente.
  async findOwn(tx: Prisma.TransactionClient, userId: string, id: string) {
    const address = await tx.address.findFirst({ where: { id, userId } });
    if (!address) throw new NotFoundException('Dirección no encontrada');
    return address;
  }

  private clearDefault(tx: Prisma.TransactionClient, userId: string) {
    return tx.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }
}
