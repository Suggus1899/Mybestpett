import { Module } from '@nestjs/common';
import {
  CatalogManageController,
  CatalogPublicController,
} from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';

@Module({
  controllers: [
    CatalogPublicController,
    CatalogManageController,
    InventoryController,
  ],
  providers: [CatalogService, InventoryService],
})
export class CatalogModule {}
