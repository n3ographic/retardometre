import type { ReactNode } from 'react';
import { IBM_Plex_Mono } from 'next/font/google';
import 'maplibre-gl/dist/maplibre-gl.css';
import './carte.css';
import './methodologie/methodologie.css';
import './terminal/terminal.css';
import './marey/marey.css';

const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-term', display: 'swap' });

export const metadata = { title: 'Observatoire TGV' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={mono.variable}>
      <body>{children}</body>
    </html>
  );
}
