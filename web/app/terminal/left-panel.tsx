import type { LiveItem } from '../../lib/map-model';
import { charBar, delayTone, gare, liveGroups, nextArrivals, topDelays } from '../../lib/terminal-model';
import InfoTip from './info-tip';

// Filtre de la carte posé depuis l'histogramme : groupe de tranches survolé, ou épinglé par un clic (Échap l'enlève).
export type BucketFilter = { idx: number[]; pinned: boolean } | null;

const brand = (t: LiveItem) => (t.brand === 'OUIGO' ? 'OG' : 'IN');
const route = (t: LiveItem) => [t.origin, t.dest].filter(Boolean).join(' → ');

export default function LeftPanel({ trains, liveFailed, onFocus, filter, onFilter }: {
  trains: LiveItem[]; liveFailed: boolean; onFocus: (trip_id: string) => void;
  filter: BucketFilter; onFilter: (f: BucketFilter) => void;
}) {
  const top = topDelays(trains, 10);
  const cancelled = trains.filter((t) => t.cancelled);
  const now = new Date();
  const down = liveFailed && trains.length === 0;
  const groups = liveGroups(trains, now);
  const maxN = Math.max(...groups.map((g) => g.n));
  const departedN = groups.reduce((n, g) => n + g.n, 0);
  const arrivals = nextArrivals(trains, 8, now);
  const key = (idx: number[]) => idx.join(',');
  const active = filter ? key(filter.idx) : null;
  const hover = (idx: number[]) => { if (!filter?.pinned) onFilter({ idx, pinned: false }); };
  const leave = () => { if (filter && !filter.pinned) onFilter(null); };
  return (
    <aside className="term-col">
      <section className="term-panel">
        <h2 className="term-panel-title">Top retards</h2>
        {down ? <p className="term-dim">INDISPONIBLE</p> : top.length === 0 ? <p className="term-dim">AUCUN RETARD</p> : (
          <ol className="top-list">
            {/* Toute la ligne sélectionne le train : carte centrée et fiche ouverte. */}
            {top.map((t) => (
              <li key={t.trip_id}>
                <button type="button" onClick={() => onFocus(t.trip_id)} title={route(t)}>
                  <span className="top-num">{brand(t)} {t.train_number}</span>
                  <span className="top-dest term-dim">{t.dest ? `→ ${gare(t.dest)}` : ''}</span>
                  <span className={`tone-${delayTone(t.delay_s, t.cancelled)}`}>+{Math.round((t.delay_s ?? 0) / 60)}′</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="term-panel">
        <div className="panel-head">
          <h2 className="term-panel-title">Retards maintenant</h2>
          <InfoTip label="Lecture de l’histogramme">
            <p>RETARDS PUBLIÉS PAR PAS DE 5′ : 0-4′ = À L’HEURE.</p>
            <p>PARTIS : TRAINS NON SUPPRIMÉS DONT L’HEURE DE DÉPART PRÉVUE EST PASSÉE, QU’ILS ROULENT, SOIENT ARRÊTÉS EN GARE OU DÉJÀ ARRIVÉS. « EN ROUTE » SUR LA CARTE NE COMPTE QUE CEUX ENTRE DEUX GARES.</p>
            <p>SURVOL D’UNE TRANCHE : SES TRAINS RESSORTENT SUR LA CARTE. CLIC : LE FILTRE RESTE, ÉCHAP L’ENLÈVE.</p>
          </InfoTip>
        </div>
        {!down && maxN > 0 && <p title="Trains non supprimés dont l’heure de départ prévue est passée : en route, arrêtés en gare ou arrivés">{departedN} PARTIS</p>}
        {down ? <p className="term-dim">INDISPONIBLE</p> : maxN === 0 ? <p className="term-dim">AUCUN TRAIN EN ROUTE</p> : (
          <ul className="live-buckets" onMouseLeave={leave}>
            {groups.map((g) => {
              const on = active === key(g.idx);
              return (
                <li key={g.label} className={`${g.n === 0 ? 'term-dim' : ''}${on ? ' on' : ''}`}>
                  <button type="button" aria-pressed={on && !!filter?.pinned}
                    title={g.idx.length > 1 ? g.detail.map((d) => `${d.bucket}′ : ${d.n}`).join(' · ') : undefined}
                    onMouseEnter={() => hover(g.idx)} onFocus={() => hover(g.idx)} onBlur={leave}
                    onClick={() => onFilter(on && filter?.pinned ? null : { idx: g.idx, pinned: true })}>
                    <span>{g.label}′</span>
                    <span className={`seg-c s${g.idx[0]}`} aria-hidden="true">{charBar((g.n / maxN) * 100, 12)}</span>
                    <span>{g.n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="live-suppr" title={cancelled.length ? cancelled.map((t) => `${t.brand} ${t.train_number} ${gare(t.dest)}`.trim()).join('\n') : undefined}>
          SUPPR. EN CIRCULATION <span className="tone-cancelled">{down ? '—' : cancelled.length}</span>
        </p>
      </section>
      <section className="term-panel">
        <h2 className="term-panel-title">Prochaines arrivées</h2>
        {down ? <p className="term-dim">INDISPONIBLE</p> : arrivals.length === 0 ? <p className="term-dim">AUCUN TRAIN EN ROUTE</p> : (
          <ol className="top-list arrivals">
            {arrivals.map((t) => {
              const min = Math.round((t.delay_s ?? 0) / 60);
              return (
                <li key={t.trip_id}>
                  <button type="button" onClick={() => onFocus(t.trip_id)} title={route(t)}>
                    <span className="arr-num">{t.eta} {brand(t)} {t.train_number}</span>
                    <span className="arr-dest">{gare(t.dest)}</span>
                    {min > 0 && <span className={`tone-${delayTone(t.delay_s, false)}`}>+{min}′</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </aside>
  );
}
