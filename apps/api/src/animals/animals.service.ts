import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { paged, paginate } from '../common/pagination.js';
import { hasAnyRole } from '../common/roles.js';
import { slugify } from '../common/slug.js';
import type {
  AnimalListingType,
  Prisma,
  Role,
  Species,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateAnimalDto,
  ListAnimalsQuery,
  UpdateAnimalDto,
} from './animals.schemas.js';
import { liveSpeciesProblem } from './live-species.js';

// Quién puede gestionar cada tipo de publicación (ADMIN siempre puede).
const rolesFor: Record<AnimalListingType, Role[]> = {
  SALE: ['CATALOG_MANAGER'],
  ADOPTION: ['ADOPTION_COORDINATOR'],
};

const include = {
  images: { orderBy: { sortOrder: 'asc' }, select: { url: true, alt: true } },
} satisfies Prisma.AnimalInclude;

// Solo especies domésticas: la fauna silvestre protegida no se publica.
function assertLiveSpecies(
  species: Species,
  breed: string | null | undefined,
  listingType: AnimalListingType,
) {
  const problem = liveSpeciesProblem(species, breed, listingType);
  if (problem) throw new BadRequestException(problem);
}

@Injectable()
export class AnimalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListAnimalsQuery) {
    const where: Prisma.AnimalWhereInput = {
      // El público ve los disponibles y los reservados (para saber que existen).
      status: { in: ['AVAILABLE', 'RESERVED'] },
      ...(query.listingType && { listingType: query.listingType }),
      ...(query.species && { species: query.species }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.animal.findMany({
        where,
        include: { images: { ...include.images, take: 1 } },
        orderBy: { createdAt: 'desc' },
        ...paginate(query.page, query.pageSize),
      }),
      this.prisma.animal.count({ where }),
    ]);
    return paged(items, total, query.page, query.pageSize);
  }

  async get(slug: string) {
    const animal = await this.prisma.animal.findUnique({
      where: { slug },
      include,
    });
    if (!animal || animal.status === 'UNAVAILABLE') {
      throw new NotFoundException('Animal no encontrado');
    }
    return animal;
  }

  async create(actor: AuthUser, dto: CreateAnimalDto) {
    this.assertCanManage(actor, dto.listingType);
    assertLiveSpecies(dto.species, dto.breed, dto.listingType);
    const { images, ...fields } = dto;
    return this.prisma.$transaction(async (tx) => {
      const animal = await tx.animal.create({
        data: {
          ...fields,
          slug:
            fields.slug ??
            slugify(
              `${fields.name}-${fields.species}-${Date.now().toString(36)}`,
            ),
          images: {
            create: images.map((image, sortOrder) => ({ ...image, sortOrder })),
          },
        },
        include,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'animal.created',
          entityType: 'animal',
          entityId: animal.id,
          metadata: { listingType: animal.listingType },
        },
        tx,
      );
      return animal;
    });
  }

  async update(actor: AuthUser, id: string, dto: UpdateAnimalDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.animal.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Animal no encontrado');
      this.assertCanManage(actor, before.listingType);
      if (dto.species !== undefined || dto.breed !== undefined) {
        assertLiveSpecies(
          dto.species ?? before.species,
          dto.breed === undefined ? before.breed : dto.breed,
          before.listingType,
        );
      }

      const price =
        dto.priceUsdCents === undefined
          ? before.priceUsdCents
          : dto.priceUsdCents;
      if (before.listingType === 'SALE' ? !price : price != null) {
        throw new BadRequestException(
          'Un animal en venta necesita precio; uno en adopción no lleva precio',
        );
      }

      const { images, ...fields } = dto;
      if (images) {
        await tx.animalImage.deleteMany({ where: { animalId: id } });
        await tx.animalImage.createMany({
          data: images.map((image, sortOrder) => ({
            ...image,
            sortOrder,
            animalId: id,
          })),
        });
      }
      const animal = await tx.animal.update({
        where: { id },
        data: fields,
        include,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'animal.updated',
          entityType: 'animal',
          entityId: id,
          metadata: {
            fields: Object.keys(dto),
            ...(dto.status && {
              status: { from: before.status, to: dto.status },
            }),
            ...(dto.priceUsdCents !== undefined && {
              priceUsdCents: {
                from: before.priceUsdCents,
                to: dto.priceUsdCents,
              },
            }),
          },
        },
        tx,
      );
      return animal;
    });
  }

  private assertCanManage(actor: AuthUser, listingType: AnimalListingType) {
    if (!hasAnyRole(actor, rolesFor[listingType])) {
      throw new ForbiddenException(
        listingType === 'SALE'
          ? 'Solo el equipo de catálogo gestiona animales en venta'
          : 'Solo el equipo de adopciones gestiona animales en adopción',
      );
    }
  }
}
