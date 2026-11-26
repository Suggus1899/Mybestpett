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

// Monto exacto en la moneda del pago (texto decimal de la API).
export function formatMoney(amount: string, currency: 'USD' | 'VES' | 'EUR' | 'USDT'): string {
  const value = number.format(Number(amount));
  switch (currency) {
    case 'USD':
      return `$${value}`;
    case 'VES':
      return `Bs. ${value}`;
    case 'EUR':
      return `${value} €`;
    case 'USDT':
      return `${value} USDT`;
  }
}

// Fecha y hora en Caracas, que es donde opera la tienda.
const dateTime = new Intl.DateTimeFormat('es-VE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Caracas',
});

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}
