import { ImageResponse } from 'next/og';

// Icône du site, du manifeste et de l'écran d'accueil : « R » ambre sur le fond du terminal.
export function appIcon(n: number) {
  return new ImageResponse(
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#ffb000', fontSize: n * 0.62, fontWeight: 700, fontFamily: 'monospace' }}>R</div>,
    { width: n, height: n },
  );
}
