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
    await prisma.user.upsert({
      where: { email },
      update: { role: 'ADMIN', isActive: true },
      create: {
        email,
        passwordHash: await argon2.hash(password),
        firstName: 'Admin',
        lastName: 'Petbf',
        role: 'ADMIN',
      },
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
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
