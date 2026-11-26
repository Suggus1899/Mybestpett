// Piezas comunes del panel administrativo.

export function NoAccess() {
  return (
    <div role="alert" className="rounded-[var(--radius-card)] border border-line bg-white p-8">
      <h1 className="mb-2 text-2xl">No tienes acceso a esta sección</h1>
      <p className="text-slate">Si crees que deberías tenerlo, pídeselo al administrador.</p>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warn' | 'danger';
}) {
  const color = { default: 'text-ink', warn: 'text-[#8a4b00]', danger: 'text-danger' }[tone];
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <p className="text-sm text-slate">{label}</p>
      <p className={`font-display text-3xl ${color}`}>{value}</p>
    </div>
  );
}
