import { Module } from '@nestjs/common';
import {
  StoreManageController,
  StorePublicController,
} from './store.controller.js';
import { StoreService } from './store.service.js';

@Module({
  controllers: [StorePublicController, StoreManageController],
  providers: [StoreService],
})
export class StoreModule {}
