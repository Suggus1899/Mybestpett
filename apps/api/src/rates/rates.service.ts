import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import type { Currency } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateRatesDto } from './rates.schemas.js';

const SOURCE = 'BCV';

// Fecha de hoy en Caracas (UTC-4, sin horario de verano) como AAAA-MM-DD.
export function caracasToday(now = new Date()): string {
  return new Date(now.getTime() - 4 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

@Injectable()
export class RatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Última tasa de cada par. Los clientes la usan para mostrar precios en Bs y euros.
  async current() {
    const [usd, eur] = await Promise.all([
      this.latest('USD'),
      this.latest('EUR'),
    ]);
    return {
      source: SOURCE,
      usdVes: usd && {
        rate: usd.rate.toString(),
        effectiveAt: usd.effectiveAt,
      },
      eurVes: eur && {
        rate: eur.rate.toString(),
        effectiveAt: eur.effectiveAt,
      },
    };
  }

  history() {
    return this.prisma.exchangeRate.findMany({
      where: { source: SOURCE },
      orderBy: [{ effectiveAt: 'desc' }, { base: 'asc' }],
      take: 60,
    });
  }

  // Volver a cargar el mismo día corrige la tasa en lugar de duplicarla.
  async create(actor: AuthUser, dto: CreateRatesDto) {
    const effectiveAt = new Date(
      `${dto.effectiveDate ?? caracasToday()}T00:00:00-04:00`,
    );
    const pairs: [Currency, string][] = [['USD', dto.usdVes]];
    if (dto.eurVes) pairs.push(['EUR', dto.eurVes]);

    await this.prisma.$transaction(async (tx) => {
      for (const [base, rate] of pairs) {
        const key = {
          base,
          quote: 'VES' as const,
          source: SOURCE,
          effectiveAt,
        };
        const previous = await tx.exchangeRate.findUnique({
          where: { base_quote_source_effectiveAt: key },
        });
        await tx.exchangeRate.upsert({
          where: { base_quote_source_effectiveAt: key },
          create: { ...key, rate, createdById: actor.id },
          update: { rate, createdById: actor.id },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            action: previous ? 'rate.corrected' : 'rate.created',
            entityType: 'exchange_rate',
            entityId: `${base}-VES-${effectiveAt.toISOString()}`,
            metadata: { from: previous?.rate.toString() ?? null, to: rate },
          },
          tx,
        );
      }
    });
    return this.current();
  }

  // Las tasas que congela un pedido al crearse.
  async forOrder() {
    const [usd, eur] = await Promise.all([
      this.latest('USD'),
      this.latest('EUR'),
    ]);
    return {
      usdVes: usd?.rate ?? null,
      eurVes: eur?.rate ?? null,
      effectiveAt: usd?.effectiveAt ?? null,
    };
  }

  private latest(base: Currency) {
    return this.prisma.exchangeRate.findFirst({
      where: {
        base,
        quote: 'VES',
        source: SOURCE,
        effectiveAt: { lte: new Date() },
      },
      orderBy: { effectiveAt: 'desc' },
    });
  }
}
