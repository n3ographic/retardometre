import type { Tone } from '../../lib/terminal-model';

type Item = { trip_id: string; label: string; minutes: number; tone: Tone; href: string | null };

// Bandeau défilant : la liste est rendue deux fois pour une boucle sans à-coup (la copie est masquée aux lecteurs d'écran).
export default function Ticker({ items, failed }: { items: Item[]; failed: boolean }) {
  if (items.length === 0) return <div className="ticker term-dim">{failed ? 'FLUX INDISPONIBLE' : 'AUCUN TRAIN EN RETARD EN CE MOMENT'}</div>;
  const list = (hidden: boolean) => (
    <ul className="ticker-list" aria-hidden={hidden || undefined}>
      {items.map((i) => (
        <li key={i.trip_id}>
          <span className={`tone-${i.tone}`}>▼ +{i.minutes}′</span>{' '}
          {i.href ? <a href={i.href} className="to-marey" tabIndex={hidden ? -1 : undefined} title="Voir sur le diagramme de Marey" aria-label={`${i.label} sur le diagramme de Marey`}>{i.label}</a> : i.label}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="ticker" tabIndex={0} aria-label="Trains les plus en retard">
      <div className="ticker-track">{list(false)}{list(true)}</div>
    </div>
  );
}
