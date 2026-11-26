import { startTransition, type FormEvent } from 'react';

// Envía el formulario sin que React lo vacíe al terminar: así, si la API
// devuelve un error, lo escrito (incluidas las casillas) sigue ahí.
// Solo para componentes de cliente.
export function keepValues(action: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
}
