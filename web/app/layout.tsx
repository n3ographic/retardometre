import type { ReactNode } from 'react';
import { IBM_Plex_Mono } from 'next/font/google';
import 'maplibre-gl/dist/maplibre-gl.css';
import './carte.css';
import './methodologie/methodologie.css';
import './terminal/terminal.css';
import './marey/marey.css';
import './train/train.css';
import './semaine/semaine.css';

const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-term', display: 'swap' });

// metadataBase : adresses absolues des images de partage (og:image) ; site de production.
export const metadata = { title: 'Retardomètre', metadataBase: new URL('https://sncf-tracking.vercel.app') };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={mono.variable}>
      <body>{children}</body>
    </html>
  );
}
