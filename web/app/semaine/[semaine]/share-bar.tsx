'use client';

import { useState } from 'react';

// Partage du bilan : résumé copié avec l'adresse de la page, image carrée à télécharger.
export default function ShareBar({ text, week }: { text: string; week: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${text}\n${location.origin}/semaine/${week}`);
      setState('ok');
    } catch {
      setState('fail');
    }
    setTimeout(() => setState('idle'), 2500);
  };
  return (
    <p className="wk-share">
      <button type="button" className="ta-btn" onClick={copy}>
        {state === 'ok' ? 'RÉSUMÉ COPIÉ ✓' : state === 'fail' ? 'COPIE IMPOSSIBLE' : 'COPIER LE RÉSUMÉ'}
      </button>
      <a className="ta-btn" href={`/semaine/${week}/carre.png`} download={`retardometre-${week}.png`}>IMAGE CARRÉE ↓</a>
      <span className="sr-only" role="status">{state === 'ok' ? 'Résumé copié dans le presse-papiers' : state === 'fail' ? 'Copie impossible' : ''}</span>
    </p>
  );
}
