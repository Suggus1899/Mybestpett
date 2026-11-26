import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AddressesModule } from './addresses/addresses.module.js';
import { AnimalsModule } from './animals/animals.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { CartModule } from './cart/cart.module.js';
import { ClientIpThrottlerGuard } from './common/client-ip.js';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { OrdersModule } from './orders/orders.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RatesModule } from './rates/rates.module.js';
import { StoreModule } from './store/store.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Límite general por IP (120 por minuto si no se indica THROTTLE_LIMIT).
    ThrottlerModule.forRoot({
      throttlers: [
        { ttl: 60_000, limit: () => Number(process.env.THROTTLE_LIMIT ?? 120) },
      ],
      // Las pruebas hacen muchas peticiones seguidas desde la misma IP.
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    AnimalsModule,
    RatesModule,
    AddressesModule,
    StoreModule,
    CartModule,
    OrdersModule,
  ],
  controllers: [HealthController],
  providers: [
    // Orden de ejecución: límite de peticiones, sesión y luego rol.
    { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
