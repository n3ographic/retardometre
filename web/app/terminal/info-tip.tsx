'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// Pastille ⓘ : un clic (ou Entrée) ouvre une bulle, Échap ou un clic ailleurs la ferme. Une vraie bulle plutôt que
// l'attribut title, pour pouvoir y mettre un lien (méthodologie) et la lire au clavier ou au toucher.
export default function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Sens et hauteur de la bulle : vers le haut quand la place manque en dessous (bloc en bas de colonne), jamais hors de l'écran.
  const [place, setPlace] = useState<{ up: boolean; max: number }>({ up: false, max: 400 });
  const root = useRef<HTMLSpanElement>(null);
  const toggle = () => {
    const r = root.current?.getBoundingClientRect();
    if (!open && r) {
      const below = window.innerHeight - r.bottom, above = r.top;
      const up = below < 320 && above > below;
      setPlace({ up, max: Math.max(120, (up ? above : below) - 16) });
    }
    setOpen((o) => !o);
  };
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
      <button type="button" className="tip-btn" aria-label={label} aria-expanded={open} aria-controls={id} onClick={toggle}>ⓘ</button>
      {open && <div className={place.up ? 'tip-body up' : 'tip-body'} style={{ maxHeight: place.max }} id={id} role="note">{children}</div>}
    </span>
  );
}
