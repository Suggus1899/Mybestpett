import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/decorators.js';
import {
  inventoryQuerySchema,
  type InventoryQuery,
} from './inventory.schemas.js';
import { InventoryService } from './inventory.service.js';

// Consulta del inventario: catálogo lo gestiona; pagos y pedidos lo consulta.
@Roles(['CATALOG_MANAGER', 'ORDERS_OPERATOR'])
@Controller('manage/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@Query({ schema: inventoryQuerySchema }) query: InventoryQuery) {
    return this.inventory.list(query);
  }

  @Get('summary')
  summary(
    @Query('lowThreshold', {
      schema: z.coerce.number().int().min(1).max(1000).default(5),
    })
    lowThreshold: number,
  ) {
    return this.inventory.summary(lowThreshold);
  }
}
