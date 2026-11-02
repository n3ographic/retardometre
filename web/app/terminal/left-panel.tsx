import { suppressionPct } from '../../lib/dashboard-model';
import type { LiveItem } from '../../lib/map-model';
import type { StatsPayload } from '../../lib/stats';
import { TERMINUS_BUCKETS } from '../../lib/dashboard-model';
import { mareyHref } from '../../lib/marey';
import { charBar, delayTone, liveBuckets, nextArrivals, periodLabel, topDelays, type Period } from '../../lib/terminal-model';

const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1 })} %`);

export default function LeftPanel({ trains, liveFailed, stats, statsFailed, statsLoading, period, onFocus }: {
  trains: LiveItem[]; liveFailed: boolean; stats: StatsPayload | null; statsFailed: boolean; statsLoading: boolean; period: Period;
  onFocus: (trip_id: string) => void;
}) {
  const top = topDelays(trains, 10);
  const cancelled = trains.filter((t) => t.cancelled);
  const now = new Date();
  const down = liveFailed && trains.length === 0;
  const buckets = liveBuckets(trains, now);
  const maxN = Math.max(...buckets.map((b) => b.n));
  const arrivals = nextArrivals(trains, 8, now);
  return (
    <aside className="term-col">
      <section className="term-panel">
        <h2 className="term-panel-title">Top retards</h2>
        {liveFailed && trains.length === 0 ? <p className="term-dim">INDISPONIBLE</p> : top.length === 0 ? <p className="term-dim">AUCUN RETARD</p> : (
          <ol className="top-list">
            {top.map((t) => {
              const tone = delayTone(t.delay_s, t.cancelled), href = mareyHref(t);
              return (
                <li key={t.trip_id}>
                  {/* Numéro = lien vers le Marey (axe couvert) ; le reste de la ligne centre la carte sur le train. */}
                  {href ? <a href={href} className="top-num to-marey" title="Voir sur le diagramme de Marey" aria-label={`Train ${t.train_number} sur le diagramme de Marey`}>{t.brand === 'OUIGO' ? 'OG' : 'IN'} {t.train_number}</a> : null}
                  <button type="button" onClick={() => onFocus(t.trip_id)} title={[t.origin, t.dest].filter(Boolean).join(' → ')}>
                    {href ? <span /> : <span>{t.brand === 'OUIGO' ? 'OG' : 'IN'} {t.train_number}</span>}
                    <span className={`tone-${tone}`}>+{Math.round((t.delay_s ?? 0) / 60)}′</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <section className="term-panel">
        <h2 className="term-panel-title">Suppressions</h2>
        <p>EN CIRCULATION <span className="tone-cancelled">{liveFailed && trains.length === 0 ? '—' : cancelled.length}</span></p>
        {cancelled.slice(0, 5).map((t) => <p key={t.trip_id} className="term-dim">{t.brand} {t.train_number} {t.dest ?? ''}</p>)}
        <p className={statsLoading && stats ? 'term-stale' : undefined}>
          TAUX {periodLabel(period)} {statsFailed || !stats ? <span className="term-dim">{statsFailed ? 'INDISPONIBLE' : '—'}</span> : pct(suppressionPct(stats.totals))}
        </p>
      </section>
      <section className="term-panel">
        <h2 className="term-panel-title">Retards maintenant</h2>
        {down ? <p className="term-dim">INDISPONIBLE</p> : maxN === 0 ? <p className="term-dim">AUCUN TRAIN EN ROUTE</p> : (
          <ul className="live-buckets">
            {buckets.map((b, i) => (
              <li key={b.bucket} className={b.n === 0 ? 'term-dim' : undefined}>
                <span>{TERMINUS_BUCKETS[i]}′</span>
                <span className={`seg-c s${i}`} aria-hidden="true">{charBar((b.n / maxN) * 100, 12)}</span>
                <span>{b.n}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="term-panel">
        <h2 className="term-panel-title">Prochaines arrivées</h2>
        {down ? <p className="term-dim">INDISPONIBLE</p> : arrivals.length === 0 ? <p className="term-dim">AUCUN TRAIN EN ROUTE</p> : (
          <ol className="top-list arrivals">
            {arrivals.map((t) => {
              const min = Math.round((t.delay_s ?? 0) / 60), href = mareyHref(t);
              return (
                <li key={t.trip_id}>
                  {href ? <a href={href} className="top-num to-marey" title="Voir sur le diagramme de Marey" aria-label={`Train ${t.train_number} sur le diagramme de Marey`}>{t.eta} {t.brand === 'OUIGO' ? 'OG' : 'IN'} {t.train_number}</a> : null}
                  <button type="button" onClick={() => onFocus(t.trip_id)} title={[t.origin, t.dest].filter(Boolean).join(' → ')}>
                    {!href && <span>{t.eta} {t.brand === 'OUIGO' ? 'OG' : 'IN'} {t.train_number}</span>}
                    <span className="arr-dest">{t.dest ?? ''}</span>
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
