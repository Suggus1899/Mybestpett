import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module.js';
import { CartModule } from '../cart/cart.module.js';
import { RatesModule } from '../rates/rates.module.js';
import {
  OrdersController,
  OrdersManageController,
} from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [AddressesModule, CartModule, RatesModule],
  controllers: [OrdersController, OrdersManageController],
  providers: [OrdersService, PaymentsService],
})
export class OrdersModule {}
