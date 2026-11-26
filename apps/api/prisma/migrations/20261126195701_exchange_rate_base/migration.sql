-- La tabla aún no tiene datos en ningún entorno, por eso "base" se añade sin valor por defecto.

-- DropIndex
DROP INDEX "exchange_rates_quote_effectiveAt_idx";

-- DropIndex
DROP INDEX "exchange_rates_quote_source_effectiveAt_key";

-- AlterTable
ALTER TABLE "exchange_rates" DROP COLUMN "fetchedAt",
ADD COLUMN     "base" "Currency" NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" UUID;

-- CreateIndex
CREATE INDEX "exchange_rates_base_quote_effectiveAt_idx" ON "exchange_rates"("base", "quote", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_base_quote_source_effectiveAt_key" ON "exchange_rates"("base", "quote", "source", "effectiveAt");

