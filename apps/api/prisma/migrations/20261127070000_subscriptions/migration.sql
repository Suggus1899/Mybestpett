-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "subscriptionId" UUID;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "subscribable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "addressId" UUID,
    "shippingZoneId" UUID NOT NULL,
    "paymentMethodId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_status_nextRunAt_idx" ON "subscriptions"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "subscriptions_userId_idx" ON "subscriptions"("userId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_shippingZoneId_fkey" FOREIGN KEY ("shippingZoneId") REFERENCES "shipping_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Una suscripción viva por cliente y presentación.
CREATE UNIQUE INDEX "subscriptions_one_open_per_variant" ON "subscriptions"("userId", "variantId") WHERE "status" <> 'CANCELLED';
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_values_check" CHECK ("quantity" BETWEEN 1 AND 10 AND "intervalDays" BETWEEN 7 AND 90 AND "failures" >= 0);
CREATE INDEX "orders_subscriptionId_idx" ON "orders"("subscriptionId");
