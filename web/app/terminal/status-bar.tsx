'use client';

import { useEffect, useState, type ReactNode } from 'react';

type Status = { status: 'ok' | 'slow' | 'late' | 'unknown'; ageMin: number | null };

const COLLECT = {
  ok: (age: number | null) => <span className="ok">COLLECTE OK{age !== null ? ` · ${age} MIN` : ''}</span>,
  slow: (age: number | null) => <span className="tone-strong">COLLECTE RALENTIE{age !== null ? ` · ${age} MIN` : ''}</span>,
  late: (age: number | null) => <span className="bad">COLLECTE EN RETARD{age !== null ? ` · ${age} MIN` : ''}</span>,
  unknown: () => <span className="term-dim">COLLECTE INCONNUE</span>,
};

// Barre d'état commune : l'horloge n'est rendue qu'après montage (pas d'écart d'hydratation).
// status et coveragePct absents : la barre ne les affiche pas (pages sans données temps réel).
export default function StatusBar({ status, coveragePct, picker }: { status?: Status | null; coveragePct?: number | null; picker?: ReactNode }) {
  const [clock, setClock] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <header className="term-bar">
      <a href="/" className="term-logo">OBS·TGV</a>
      <span>LIVE {clock ?? '--:--:--'} PARIS</span>
      {picker}
      {status && COLLECT[status.status](status.ageMin)}
      {coveragePct !== undefined && <span title="Part des trains prévus observés dans le flux temps réel, jours terminés depuis le 20 octobre 2026">OBS. DEPUIS 20/10 {coveragePct === null ? '—' : `${coveragePct.toLocaleString('fr-FR', { minimumFractionDigits: 1 })} %`}</span>}
    </header>
  );
}
