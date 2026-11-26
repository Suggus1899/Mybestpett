import { Module } from '@nestjs/common';
import {
  CombosController,
  CombosManageController,
  CouponsManageController,
} from './promotions.controller.js';
import { PromotionsService } from './promotions.service.js';

@Module({
  controllers: [
    CombosController,
    CombosManageController,
    CouponsManageController,
  ],
  providers: [PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
