import type { MetadataRoute } from 'next';

// Manifeste d'application : sur iPhone, les notifications ne marchent que depuis le site ajouté à l'écran d'accueil.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Retardomètre', short_name: 'Retardomètre', description: 'Retards des TGV en temps réel',
    start_url: '/', display: 'standalone', background_color: '#0a0a0a', theme_color: '#0a0a0a', lang: 'fr',
    icons: [
      { src: '/icon/192', sizes: '192x192', type: 'image/png' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png' },
    ],
  };
}
