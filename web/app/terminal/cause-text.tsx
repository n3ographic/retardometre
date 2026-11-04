'use client';

import { useState } from 'react';
import { causeExcerpt, isGenericCause } from '../../lib/causes';

// Texte de cause SNCF coupé en fin de phrase ; texte complet au survol et au clic.
export default function CauseText({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const { short, cut } = causeExcerpt(text);
  if (isGenericCause(text)) return <span className={className} title={text}>Cause non précisée par la SNCF</span>;
  return (
    <span className={className} title={cut && !open ? text : undefined}>
      {open ? text : short}
      {cut && <> <button type="button" className="cause-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'RÉDUIRE' : 'LIRE TOUT'}</button></>}
    </span>
  );
}
