-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FIXED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "comboDiscountUsdCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "couponDiscountUsdCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "couponId" UUID;

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" INTEGER NOT NULL,
    "minSubtotalUsdCents" INTEGER NOT NULL DEFAULT 0,
    "maxDiscountUsdCents" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combos" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priceUsdCents" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "combos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_items" (
    "id" UUID NOT NULL,
    "comboId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "combo_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "combos_slug_key" ON "combos"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "combo_items_comboId_variantId_key" ON "combo_items"("comboId", "variantId");

-- CreateIndex
CREATE INDEX "orders_couponId_idx" ON "orders"("couponId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas que la API ya valida, repetidas en la base como última defensa.
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_check" CHECK ("value" > 0 AND ("type" <> 'PERCENT' OR "value" <= 90));
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_limits_check" CHECK ("perUserLimit" >= 1 AND ("maxRedemptions" IS NULL OR "maxRedemptions" >= 1) AND "minSubtotalUsdCents" >= 0);
ALTER TABLE "combos" ADD CONSTRAINT "combos_price_check" CHECK ("priceUsdCents" > 0);
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_quantity_check" CHECK ("quantity" BETWEEN 1 AND 20);
ALTER TABLE "orders" ADD CONSTRAINT "orders_discounts_check" CHECK ("comboDiscountUsdCents" >= 0 AND "couponDiscountUsdCents" >= 0 AND "comboDiscountUsdCents" + "couponDiscountUsdCents" <= "subtotalUsdCents");
