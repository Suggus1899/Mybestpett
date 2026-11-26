// Formatos de dinero para Venezuela: coma decimal y punto de miles.
const number = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(cents: number): string {
  return `$${number.format(cents / 100)}`;
}

// rate: bolívares por 1 dólar, como texto decimal de la API.
export function formatBs(cents: number, rate: string): string {
  return `Bs. ${number.format((cents / 100) * Number(rate))}`;
}

export function formatInt(value: number): string {
  return new Intl.NumberFormat('es-VE').format(value);
}
