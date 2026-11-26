import { Module } from '@nestjs/common';
import {
  CatalogManageController,
  CatalogPublicController,
} from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  controllers: [CatalogPublicController, CatalogManageController],
  providers: [CatalogService],
})
export class CatalogModule {}
