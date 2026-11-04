import { TERMINUS_BUCKETS, suppressionPct } from '../../lib/dashboard-model';
import type { LiveItem } from '../../lib/map-model';
import type { StatsPayload } from '../../lib/stats';
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
  const departedN = buckets.reduce((n, b) => n + b.n, 0);
  const arrivals = nextArrivals(trains, 8, now);
  return (
    <aside className="term-col">
      <section className="term-panel">
        <h2 className="term-panel-title">Top retards</h2>
        {liveFailed && trains.length === 0 ? <p className="term-dim">INDISPONIBLE</p> : top.length === 0 ? <p className="term-dim">AUCUN RETARD</p> : (
          <ol className="top-list">
            {/* Toute la ligne sélectionne le train : carte centrée et fiche ouverte. */}
            {top.map((t) => (
              <li key={t.trip_id}>
                <button type="button" onClick={() => onFocus(t.trip_id)} title={[t.origin, t.dest].filter(Boolean).join(' → ')}>
                  <span>{t.brand === 'OUIGO' ? 'OG' : 'IN'} {t.train_number}</span>
                  <span className={`tone-${delayTone(t.delay_s, t.cancelled)}`}>+{Math.round((t.delay_s ?? 0) / 60)}′</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="term-panel">
        <h2 className="term-panel-title">Retards maintenant</h2>
        {!down && maxN > 0 && <p title="Trains partis et non supprimés, y compris à l’arrêt ou arrivés (0-4′ = à l’heure)">{departedN} PARTIS</p>}
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
        <p className="live-suppr" title={cancelled.length ? cancelled.map((t) => `${t.brand} ${t.train_number} ${t.dest ?? ''}`.trim()).join('\n') : undefined}>
          SUPPR. EN CIRCULATION <span className="tone-cancelled">{down ? '—' : cancelled.length}</span>
          {' · '}<span className={statsLoading && stats ? 'term-stale' : undefined}>TAUX {periodLabel(period)} {statsFailed || !stats ? <span className="term-dim">{statsFailed ? 'INDISPONIBLE' : '—'}</span> : pct(suppressionPct(stats.totals))}</span>
        </p>
        <p className="term-dim live-note">PAR PAS DE 5′ : 0-4′ = À L’HEURE</p>
      </section>
      <section className="term-panel">
        <h2 className="term-panel-title">Prochaines arrivées</h2>
        {down ? <p className="term-dim">INDISPONIBLE</p> : arrivals.length === 0 ? <p className="term-dim">AUCUN TRAIN EN ROUTE</p> : (
          <ol className="top-list arrivals">
            {arrivals.map((t) => {
              const min = Math.round((t.delay_s ?? 0) / 60);
              return (
                <li key={t.trip_id}>
                  <button type="button" onClick={() => onFocus(t.trip_id)} title={[t.origin, t.dest].filter(Boolean).join(' → ')}>
                    <span className="arr-num">{t.eta} {t.brand === 'OUIGO' ? 'OG' : 'IN'} {t.train_number}</span>
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
