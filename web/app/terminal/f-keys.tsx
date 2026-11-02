'use client';

import { useEffect } from 'react';

// F3 ouvre le diagramme de Marey (F3 est « rechercher » dans les navigateurs : on le détourne sur cette page seulement).
export default function FKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F3' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      if (window.location.pathname !== '/marey') window.location.assign('/marey');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
