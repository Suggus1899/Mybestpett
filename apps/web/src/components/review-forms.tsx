'use client';

import { useActionState } from 'react';
import type { MyReview } from '@/lib/api';
import { keepValues } from '@/lib/keep-values';
import { deleteReviewAction, moderateReviewAction, saveReviewAction, type ActionState } from '@/lib/shop-actions';
import { Button, Field, inputClass, Notice } from './ui';

// Escribir o editar la reseña propia. Las estrellas son radios: se eligen con
// teclado y el lector de pantalla las anuncia.
export function ReviewForm({ slug, mine }: { slug: string; mine: MyReview['review'] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveReviewAction, {});
  const f = state.fields;
  const rating = f?.rating ?? (mine ? String(mine.rating) : '');
  return (
    <div className="flex flex-col gap-3">
      {mine?.status === 'HIDDEN' && (
        <p role="status" className="rounded-[var(--radius-field)] bg-red-50 px-4 py-3 text-danger">
          El equipo ocultó tu reseña: {mine.hiddenReason}
        </p>
      )}
      <form onSubmit={keepValues(action)} aria-label={mine ? 'Editar mi reseña' : 'Escribir una reseña'} className="flex flex-col gap-3">
        <Notice error={state.error} ok={state.ok} />
        <input type="hidden" name="slug" value={slug} />
        <fieldset>
          <legend className="mb-1 font-bold">Tu valoración</legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1">
                <input type="radio" name="rating" value={n} required defaultChecked={rating === String(n)} />
                <span>
                  {n} <span aria-hidden="true">★</span>
                  <span className="sr-only">{n === 1 ? 'estrella' : 'estrellas'}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Título (opcional)" id="review-title" name="title" maxLength={80} defaultValue={f?.title ?? mine?.title ?? ''} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="review-body" className="font-bold">
            Tu experiencia
          </label>
          <textarea
            id="review-body"
            name="body"
            required
            minLength={10}
            maxLength={1000}
            rows={4}
            defaultValue={f?.body ?? mine?.body ?? ''}
            className={`${inputClass} py-3`}
          />
        </div>
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? 'Guardando…' : mine ? 'Guardar cambios' : 'Publicar reseña'}
        </Button>
      </form>
      {mine && (
        <form action={deleteReviewAction}>
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" variant="secondary">
            Borrar mi reseña
          </Button>
        </form>
      )}
    </div>
  );
}

// Panel: ocultar con motivo o volver a mostrar.
export function ModerateReviewForm({ id, status }: { id: string; status: 'VISIBLE' | 'HIDDEN' }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(moderateReviewAction, {});
  return (
    <form onSubmit={keepValues(action)} className="flex flex-col gap-2">
      <Notice error={state.error} ok={state.ok} />
      <input type="hidden" name="reviewId" value={id} />
      <input type="hidden" name="status" value={status === 'VISIBLE' ? 'HIDDEN' : 'VISIBLE'} />
      {status === 'VISIBLE' && (
        <Field
          label="Motivo para ocultarla"
          id={`hide-${id}`}
          name="reason"
          required
          minLength={5}
          maxLength={300}
          defaultValue={state.fields?.reason}
          hint="El autor lo verá."
        />
      )}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {status === 'VISIBLE' ? 'Ocultar' : 'Volver a mostrar'}
      </Button>
    </form>
  );
}
