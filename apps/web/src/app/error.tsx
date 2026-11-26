'use client';

import { Button } from '@/components/ui';

// Se muestra si la API falla o no responde. No se enseñan detalles técnicos.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="mb-3 text-4xl">Algo salió mal</h1>
      <p className="mb-6 text-slate">No pudimos cargar esta página. Inténtalo de nuevo en un momento.</p>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}
