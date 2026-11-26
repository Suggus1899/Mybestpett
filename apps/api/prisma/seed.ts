// Datos iniciales: la cuenta de administrador y las categorías base.
// Uso: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... pnpm prisma:seed
// Se puede ejecutar varias veces: no duplica nada.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const categories = [
  { name: 'Perros', slug: 'perros' },
  { name: 'Gatos', slug: 'gatos' },
  { name: 'Aves', slug: 'aves' },
  { name: 'Peces', slug: 'peces' },
  { name: 'Roedores', slug: 'roedores' },
  { name: 'Reptiles', slug: 'reptiles' },
];

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 12) {
      throw new Error('SEED_ADMIN_PASSWORD debe tener al menos 12 caracteres');
    }
    const admin = await prisma.user.upsert({
      where: { email },
      update: { isActive: true },
      create: {
        email,
        passwordHash: await argon2.hash(password),
        firstName: 'Admin',
        lastName: 'Petbf',
      },
    });
    await prisma.userRole.createMany({
      data: [
        { userId: admin.id, role: 'CUSTOMER' },
        { userId: admin.id, role: 'ADMIN' },
      ],
      skipDuplicates: true,
    });
    console.log(`Administrador listo: ${email}`);
  } else {
    console.log(
      'Sin SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD: no se crea administrador.',
    );
  }

  for (const [sortOrder, category] of categories.entries()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: { ...category, sortOrder },
    });
  }
  console.log(`${categories.length} categorías base listas.`);

  if (process.env.SEED_DEMO === 'true') await seedDemo();
}

// Datos de ejemplo para desarrollo (SEED_DEMO=true). Nunca en producción.
async function seedDemo() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SEED_DEMO no se puede usar en producción');
  }
  const bySlug = async (slug: string) =>
    (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;
  const brand = await prisma.brand.upsert({
    where: { slug: 'nutripet' },
    update: {},
    create: { name: 'NutriPet', slug: 'nutripet' },
  });

  const products = [
    {
      slug: 'croquetas-perro-adulto-pollo',
      name: 'Croquetas perro adulto sabor pollo',
      category: 'perros',
      species: ['DOG'] as const,
      isReturnable: false,
      variants: [
        {
          sku: 'NP-PA-3',
          name: 'Saco 3 kg',
          priceUsdCents: 1450,
          compareAtUsdCents: 1700,
          stock: 12,
        },
        { sku: 'NP-PA-15', name: 'Saco 15 kg', priceUsdCents: 5200, stock: 3 },
      ],
    },
    {
      slug: 'arena-aglomerante-gatos',
      name: 'Arena aglomerante para gatos',
      category: 'gatos',
      species: ['CAT'] as const,
      isReturnable: false,
      variants: [
        { sku: 'AR-10', name: 'Bolsa 10 kg', priceUsdCents: 900, stock: 0 },
      ],
    },
    {
      slug: 'jaula-mediana-aves',
      name: 'Jaula mediana para aves',
      category: 'aves',
      species: ['BIRD'] as const,
      isReturnable: true,
      variants: [
        { sku: 'JA-M', name: 'Mediana', priceUsdCents: 3500, stock: 6 },
      ],
    },
  ];
  for (const p of products) {
    const { category, variants, ...fields } = p;
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        ...fields,
        species: [...fields.species],
        description: `${p.name}. Producto de ejemplo para desarrollo.`,
        categoryId: await bySlug(category),
        brandId: brand.id,
        variants: { create: variants },
      },
    });
  }

  await prisma.animal.upsert({
    where: { slug: 'luna-gata-adopcion' },
    update: {},
    create: {
      slug: 'luna-gata-adopcion',
      name: 'Luna',
      listingType: 'ADOPTION',
      species: 'CAT',
      sex: 'FEMALE',
      birthDate: new Date('2025-03-10'),
      description: 'Gata tranquila y cariñosa. Ejemplo para desarrollo.',
      isVaccinated: true,
      isSterilized: true,
    },
  });
  await prisma.animal.upsert({
    where: { slug: 'periquito-azul' },
    update: {},
    create: {
      slug: 'periquito-azul',
      name: 'Periquito azul',
      listingType: 'SALE',
      species: 'BIRD',
      description: 'Periquito joven. Ejemplo para desarrollo.',
      priceUsdCents: 2500,
    },
  });

  const effectiveAt = new Date(Date.now() - 60_000);
  for (const [base, rate] of [
    ['USD', '245.50'],
    ['EUR', '268.10'],
  ] as const) {
    await prisma.exchangeRate.upsert({
      where: {
        base_quote_source_effectiveAt: {
          base,
          quote: 'VES',
          source: 'BCV',
          effectiveAt,
        },
      },
      update: {},
      create: { base, quote: 'VES', source: 'BCV', effectiveAt, rate },
    });
  }
  console.log(
    'Datos de ejemplo listos (productos, animales y una tasa ficticia).',
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
