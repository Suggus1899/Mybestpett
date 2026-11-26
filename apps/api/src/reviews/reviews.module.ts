import { Module } from '@nestjs/common';
import {
  ReviewsController,
  ReviewsManageController,
} from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

@Module({
  controllers: [ReviewsController, ReviewsManageController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
