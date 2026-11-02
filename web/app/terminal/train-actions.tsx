'use client';

import { useEffect } from 'react';
import { viewHref, type View } from '../../lib/command';
import { typing } from './command-bar';

const VIEWS: View[] = ['CARTE', 'MAREY', 'FICHE'];

// Barre d'actions d'un train, la même sur la carte, le Marey et la fiche : la vue en cours est marquée et inerte,
// CARTE est grisé quand le train n'a pas de position. Touches C, M, F hors saisie.
export default function TrainActions({ number, current, onMap }: { number: string; current: View; onMap: boolean }) {
  const enabled = (v: View) => v !== current && (v !== 'CARTE' || onMap);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
      const v = VIEWS.find((x) => x[0] === e.key.toUpperCase());
      if (!v || !enabled(v)) return;
      e.preventDefault();
      window.location.assign(viewHref(v, number));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <nav className="train-actions" aria-label={`Voir le train ${number}`}>
      {VIEWS.map((v) => {
        const body = <><kbd aria-hidden="true">{v[0]}</kbd>{v}</>;
        if (v === current) return <span key={v} className="ta-btn on" aria-current="page">{body}</span>;
        if (!enabled(v)) return <span key={v} className="ta-btn off" aria-disabled="true" title="PAS EN CIRCULATION">{body}</span>;
        return <a key={v} className="ta-btn" href={viewHref(v, number)} aria-keyshortcuts={v[0]}>{body}</a>;
      })}
    </nav>
  );
}
