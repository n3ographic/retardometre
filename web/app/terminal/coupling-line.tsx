'use client';

import { useEffect, useState } from 'react';
import { viewHref } from '../../lib/command';
import { asCoupling, couplingLabel, type Coupling } from '../../lib/train-coupling';

// Ligne « couplé avec le N » du volet de la carte : lue au chargement du train, rien ne s'affiche sans partenaire ni en cas d'erreur.
export default function CouplingLine({ number }: { number: string }) {
  const [c, setC] = useState<Coupling | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    setC(null);
    fetch(`/api/couplage?train=${encodeURIComponent(number)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((raw) => setC(asCoupling(raw)))
      .catch(() => {});
    return () => ctl.abort();
  }, [number]);
  if (!c) return null;
  const { route, seen } = couplingLabel(c);
  return (
    <p className="tp-coupling">
      COUPLÉ AVEC LE <a className="to-marey" href={viewHref('CARTE', c.partner)}>{c.partner}</a> {route}
      {seen && <span className="term-dim"> · {seen}</span>}
    </p>
  );
}
