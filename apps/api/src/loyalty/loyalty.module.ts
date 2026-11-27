import { Module } from '@nestjs/common';
import {
  PointsController,
  PointsManageController,
} from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';

@Module({
  controllers: [PointsController, PointsManageController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
