import type { Metadata } from 'next';
import { Fredoka, Nunito } from 'next/font/google';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import './globals.css';

const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['600'],
  variable: '--font-fredoka',
});

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '700', '800'],
  variable: '--font-nunito',
});

export const metadata: Metadata = {
  title: { default: 'Petbf: todo para tu mascota', template: '%s · Petbf' },
  description:
    'Alimento, accesorios, animales y adopción en Venezuela. Envío gratis desde 25 $.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${fredoka.variable} ${nunito.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
