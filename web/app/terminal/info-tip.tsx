'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// Pastille ⓘ : un clic (ou Entrée) ouvre une bulle, Échap ou un clic ailleurs la ferme. Une vraie bulle plutôt que
// l'attribut title, pour pouvoir y mettre un lien (méthodologie) et la lire au clavier ou au toucher.
export default function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span className="tip" ref={root}>
      <button type="button" className="tip-btn" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>ⓘ</button>
      {open && <div className="tip-body" id={id} role="note">{children}</div>}
    </span>
  );
}
