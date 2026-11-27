-- CreateEnum
CREATE TYPE "PointsReason" AS ENUM ('EARNED', 'REDEEMED', 'RESTORED', 'REVERSED', 'ADJUSTED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pointsDiscountUsdCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pointsEarned" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pointsRedeemed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "points_entries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "PointsReason" NOT NULL,
    "orderId" UUID,
    "returnId" UUID,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "points_entries_userId_createdAt_idx" ON "points_entries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "points_entries_orderId_idx" ON "points_entries"("orderId");

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "return_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Los puntos también descuentan de los productos: entre todo no pasan del subtotal.
ALTER TABLE "orders" DROP CONSTRAINT "orders_discounts_check";
ALTER TABLE "orders" ADD CONSTRAINT "orders_discounts_check" CHECK ("comboDiscountUsdCents" >= 0 AND "couponDiscountUsdCents" >= 0 AND "pointsDiscountUsdCents" >= 0 AND "comboDiscountUsdCents" + "couponDiscountUsdCents" + "pointsDiscountUsdCents" <= "subtotalUsdCents");
ALTER TABLE "orders" ADD CONSTRAINT "orders_points_check" CHECK ("pointsRedeemed" >= 0 AND "pointsEarned" >= 0 AND "pointsRedeemed" % 100 = 0);
ALTER TABLE "points_entries" ADD CONSTRAINT "points_entries_delta_check" CHECK ("delta" <> 0);
