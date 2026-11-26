import { ButtonLink } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="mb-3 text-4xl">No encontramos esta página</h1>
      <p className="mb-6 text-slate">Puede que el producto ya no esté disponible o que el enlace esté mal.</p>
      <ButtonLink href="/productos">Ver productos</ButtonLink>
    </div>
  );
}
