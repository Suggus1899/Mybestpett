import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import {
  advanceOrderSchema,
  approveReturnSchema,
  cancelOrderSchema,
  checkoutSchema,
  listMyOrdersSchema,
  listOrdersManageSchema,
  listPaymentsSchema,
  listReturnsSchema,
  refundReturnSchema,
  rejectPaymentSchema,
  rejectReturnSchema,
  reportPaymentSchema,
  requestReturnSchema,
  type ApproveReturnDto,
  type AdvanceOrderDto,
  type CancelOrderDto,
  type CheckoutDto,
  type ListMyOrdersQuery,
  type ListOrdersManageQuery,
  type ListPaymentsQuery,
  type ListReturnsQuery,
  type RefundReturnDto,
  type RejectPaymentDto,
  type ReportPaymentDto,
  type RequestReturnDto,
} from './orders.schemas.js';
import { OrdersService } from './orders.service.js';
import { PaymentsService } from './payments.service.js';
import { ReturnsService } from './returns.service.js';

const id = z.uuid('Id inválido');

// Pedidos de la persona con sesión.
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly returns: ReturnsService,
  ) {}

  @Post()
  checkout(
    @CurrentUser() user: AuthUser,
    @Body({ schema: checkoutSchema }) dto: CheckoutDto,
  ) {
    return this.orders.checkout(user, dto);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listMyOrdersSchema }) query: ListMyOrdersQuery,
  ) {
    return this.orders.listMine(user.id, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) orderId: string,
  ) {
    return this.orders.getMine(user.id, orderId);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) orderId: string,
  ) {
    return this.orders.cancelMine(user, orderId);
  }

  @Post(':id/payments')
  reportPayment(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) orderId: string,
    @Body({ schema: reportPaymentSchema }) dto: ReportPaymentDto,
  ) {
    return this.payments.report(user, orderId, dto);
  }

  @Post(':id/returns')
  requestReturn(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) orderId: string,
    @Body({ schema: requestReturnSchema }) dto: RequestReturnDto,
  ) {
    return this.returns.request(user, orderId, dto);
  }
}

// Gestión de pedidos y verificación de pagos: operador de pagos y pedidos.
@Roles(['ORDERS_OPERATOR'])
@Controller('manage')
export class OrdersManageController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('orders')
  list(
    @Query({ schema: listOrdersManageSchema }) query: ListOrdersManageQuery,
  ) {
    return this.orders.listManage(query);
  }

  @Get('orders/:id')
  get(@Param('id', { schema: id }) orderId: string) {
    return this.orders.getManage(orderId);
  }

  @Post('orders/:id/status')
  advance(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) orderId: string,
    @Body({ schema: advanceOrderSchema }) dto: AdvanceOrderDto,
  ) {
    return this.orders.advance(actor, orderId, dto);
  }

  @Post('orders/:id/cancel')
  cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) orderId: string,
    @Body({ schema: cancelOrderSchema }) dto: CancelOrderDto,
  ) {
    return this.orders.cancelManage(actor, orderId, dto.reason);
  }

  @Get('payments')
  listPayments(
    @Query({ schema: listPaymentsSchema }) query: ListPaymentsQuery,
  ) {
    return this.payments.list(query);
  }

  @Post('payments/:id/verify')
  verify(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) paymentId: string,
  ) {
    return this.payments.verify(actor, paymentId);
  }

  @Post('payments/:id/reject')
  reject(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) paymentId: string,
    @Body({ schema: rejectPaymentSchema }) dto: RejectPaymentDto,
  ) {
    return this.payments.reject(actor, paymentId, dto.reason);
  }
}

// Devoluciones: el operador las revisa; solo el administrador reembolsa.
@Roles(['ORDERS_OPERATOR'])
@Controller('manage/returns')
export class ReturnsManageController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  list(@Query({ schema: listReturnsSchema }) query: ListReturnsQuery) {
    return this.returns.list(query);
  }

  @Get(':id')
  get(@Param('id', { schema: id }) returnId: string) {
    return this.returns.get(returnId);
  }

  @Post(':id/approve')
  approve(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) returnId: string,
    @Body({ schema: approveReturnSchema }) dto: ApproveReturnDto,
  ) {
    return this.returns.approve(actor, returnId, dto.note);
  }

  @Post(':id/reject')
  reject(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) returnId: string,
    @Body({ schema: rejectReturnSchema }) dto: RejectPaymentDto,
  ) {
    return this.returns.reject(actor, returnId, dto.reason);
  }

  @Roles(['ADMIN'])
  @Post(':id/refund')
  refund(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) returnId: string,
    @Body({ schema: refundReturnSchema }) dto: RefundReturnDto,
  ) {
    return this.returns.refund(actor, returnId, dto);
  }
}
