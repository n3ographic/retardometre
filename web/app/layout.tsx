import type { ReactNode } from 'react';
import { IBM_Plex_Mono } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import 'maplibre-gl/dist/maplibre-gl.css';
import './carte.css';
import './methodologie/methodologie.css';
import './terminal/terminal.css';
import './marey/marey.css';
import './train/train.css';
import './semaine/semaine.css';

const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-term', display: 'swap' });

// metadataBase : adresses absolues des images de partage (og:image) ; site de production.
// appleWebApp : plein écran une fois ajouté à l'écran d'accueil d'un iPhone (condition des notifications).
export const metadata = {
  title: 'Retardomètre', metadataBase: new URL('https://retardometre.vercel.app'),
  appleWebApp: { capable: true, title: 'Retardomètre', statusBarStyle: 'black' as const },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={mono.variable}>
      {/* Vercel Web Analytics : visites et pages vues, sans cookie ; n'envoie rien en local, seulement une fois déployé. */}
      <body>{children}<Analytics /></body>
    </html>
  );
}
