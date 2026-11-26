import Link from 'next/link';
import { ButtonLink } from '@/components/ui';

// Categorías base (las mismas del seed). La portada no depende de la API.
const categories = [
  { slug: 'perros', name: 'Perros' },
  { slug: 'gatos', name: 'Gatos' },
  { slug: 'aves', name: 'Aves' },
  { slug: 'peces', name: 'Peces' },
  { slug: 'roedores', name: 'Roedores' },
  { slug: 'reptiles', name: 'Reptiles' },
];

export default function Home() {
  return (
    <>
      <section className="bg-petbf-soft">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-14 sm:py-20">
          <h1 className="max-w-2xl text-4xl leading-tight sm:text-5xl">
            Todo lo que tu mascota necesita, en un solo lugar
          </h1>
          <p className="max-w-xl text-lg text-slate">
            Alimento, accesorios y cuidado. También animales en venta y en adopción.
            Paga en bolívares, dólares o USDT.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/productos">Ver productos</ButtonLink>
            <ButtonLink href="/animales?tipo=adopcion" variant="secondary">
              Adoptar
            </ButtonLink>
          </div>
        </div>
      </section>

      <div className="bg-amber text-ink">
        <p className="mx-auto max-w-6xl px-4 py-2 text-center font-bold">
          Envío gratis en compras desde 25 $
        </p>
      </div>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="mb-6 text-3xl">Compra por mascota</h2>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {categories.map((category) => (
            <li key={category.slug}>
              <Link
                href={`/productos?categoria=${category.slug}`}
                className="flex min-h-24 items-center justify-center rounded-[var(--radius-card)] border border-line bg-white p-4 text-center font-bold hover:border-petbf"
              >
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 md:grid-cols-2">
        <article
          className="rounded-[var(--radius-card)] border border-line bg-white p-6"
        >
          <h2 className="mb-2 text-2xl">Animales en venta</h2>
          <p className="mb-3 text-slate">Cachorros, aves y peces con su ficha de salud.</p>
          <Link href="/animales?tipo=venta" className="font-bold text-petbf hover:underline">
            Ver animales en venta
          </Link>
        </article>
        <article
          className="rounded-[var(--radius-card)] border border-line bg-white p-6"
        >
          <h2 className="mb-2 text-2xl">Adopción</h2>
          <p className="mb-3 text-slate">Dale un hogar a quien lo necesita.</p>
          <Link href="/animales?tipo=adopcion" className="font-bold text-petbf hover:underline">
            Conocer a quienes buscan hogar
          </Link>
        </article>
      </section>
    </>
  );
}
