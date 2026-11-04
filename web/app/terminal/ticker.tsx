import type { TickerItem } from '../../lib/terminal-model';

// Bandeau défilant : événements récents (seuil d'indemnité franchi, suppression, record), sinon les trains en retard au-delà du Top 10.
// La liste est rendue deux fois pour une boucle sans à-coup (la copie est masquée aux lecteurs d'écran).
// Un clic sur un train le sélectionne, comme partout sur l'accueil.
export default function Ticker({ items, failed, onFocus }: { items: TickerItem[]; failed: boolean; onFocus: (trip_id: string) => void }) {
  if (items.length === 0) return <div className="ticker term-dim">{failed ? 'FLUX INDISPONIBLE' : 'AUCUN ÉVÉNEMENT NI TRAIN EN RETARD EN CE MOMENT'}</div>;
  const list = (hidden: boolean) => (
    <ul className="ticker-list" aria-hidden={hidden || undefined}>
      {items.map((i) => (
        <li key={i.key}>
          <button type="button" className="ticker-btn" tabIndex={hidden ? -1 : undefined} onClick={() => onFocus(i.trip_id)}>
            <span className={`tone-${i.tone}`}>{i.tag}</span> {i.label}
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="ticker" role="region" aria-label="Événements et trains en retard">
      <div className="ticker-track">{list(false)}{list(true)}</div>
    </div>
  );
}
