import Link from 'next/link';
import { Suspense } from 'react';
import { Picture, Price } from '@/components/catalog';
import { api, speciesLabel, type Animal } from '@/lib/api';

const sexLabel: Record<Animal['sex'], string> = {
  MALE: 'Macho',
  FEMALE: 'Hembra',
  UNKNOWN: 'Sin determinar',
};

// "1 año y 3 meses", "4 meses"...
function age(birthDate: string, now = new Date()): string {
  const birth = new Date(birthDate);
  let months =
    (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  if (now.getDate() < birth.getDate()) months -= 1;
  if (months < 1) return 'Menos de un mes';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years === 1 ? '1 año' : `${years} años`;
  const m = rest === 1 ? '1 mes' : `${rest} meses`;
  if (years === 0) return m;
  return rest === 0 ? y : `${y} y ${m}`;
}

async function AnimalDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [animal, rates] = await Promise.all([api.animal(slug), api.rates()]);
  const rate = rates.usdVes?.rate ?? null;
  const facts = [
    ['Especie', speciesLabel[animal.species]],
    ['Raza', animal.breed ?? 'Mestizo'],
    ['Sexo', sexLabel[animal.sex]],
    ['Edad', animal.birthDate ? age(animal.birthDate) : 'Sin dato'],
    ['Vacunado', animal.isVaccinated ? 'Sí' : 'No'],
    ['Esterilizado', animal.isSterilized ? 'Sí' : 'No'],
  ];

  return (
    <>
      <nav aria-label="Migas de pan" className="mb-6 text-sm text-slate">
        <Link href="/animales" className="hover:underline">
          Animales
        </Link>
        {' / '}
        <Link
          href={`/animales?tipo=${animal.listingType === 'SALE' ? 'venta' : 'adopcion'}`}
          className="hover:underline"
        >
          {animal.listingType === 'SALE' ? 'En venta' : 'En adopción'}
        </Link>
      </nav>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
          <Picture image={animal.images[0] ?? null} fallback={speciesLabel[animal.species]} />
        </div>
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-4xl">{animal.name}</h1>
            {animal.status === 'RESERVED' && (
              <p className="mt-2 font-bold text-slate">Reservado: ya hay alguien interesado.</p>
            )}
          </div>
          {animal.listingType === 'SALE' && animal.priceUsdCents != null ? (
            <Price usdCents={animal.priceUsdCents} rate={rate} size="lg" />
          ) : (
            <p className="text-xl font-bold text-petbf">En adopción</p>
          )}
          <dl className="grid grid-cols-2 gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-slate">{label}</dt>
                <dd className="font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="whitespace-pre-line">{animal.description}</p>
          <p className="rounded-[var(--radius-field)] bg-petbf-soft p-4 text-sm">
            {animal.listingType === 'ADOPTION'
              ? 'Las solicitudes de adopción se abren en la próxima versión.'
              : 'La reserva y el pago se abren en la próxima versión.'}
          </p>
        </div>
      </div>
    </>
  );
}

export default function AnimalPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Suspense fallback={<p className="text-slate">Cargando…</p>}>
        <AnimalDetail params={params} />
      </Suspense>
    </div>
  );
}
