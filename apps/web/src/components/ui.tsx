import Link from 'next/link';
import type { ComponentProps } from 'react';

// Piezas mínimas de la identidad: botones píldora y campos de 44 px o más.

const buttonBase =
  'inline-flex min-h-11 items-center justify-center rounded-full px-6 font-bold transition-colors disabled:opacity-60';

const variants = {
  primary: 'bg-petbf text-white hover:bg-petbf-dark',
  secondary: 'border border-petbf text-petbf hover:bg-petbf-soft',
};

type Variant = keyof typeof variants;

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: Variant }) {
  return (
    <button className={`${buttonBase} ${variants[variant]} ${className}`} {...props} />
  );
}

export function ButtonLink({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${buttonBase} ${variants[variant]} ${className}`} {...props} />;
}

export function Field({
  label,
  id,
  hint,
  ...props
}: ComponentProps<'input'> & { label: string; id: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-bold">
        {label}
      </label>
      <input
        id={id}
        className="min-h-11 rounded-[var(--radius-field)] border border-line bg-white px-4 outline-none focus:border-petbf"
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-slate">
          {hint}
        </p>
      )}
    </div>
  );
}
