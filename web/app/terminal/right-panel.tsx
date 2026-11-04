import { isSmallSample, suppressionPct } from '../../lib/dashboard-model';
import { COUNT_KEYS, COUNT_LABELS, breakdownText } from '../../lib/counts';
import type { CumulPayload } from '../../lib/cumul';
import { lastCompleteWeek, lastCompleteWeekId } from '../../lib/weekly';
import { splitLabel, type StatsPayload } from '../../lib/stats';
import { CUMUL_MAX_AGE_MIN, RANGE_HINT, STATS_MAX_AGE_MIN, calcLabel, eurRange, isCalcStale, periodLabel, rangeLabel, windowLabel, type Period } from '../../lib/terminal-model';
import InfoTip from './info-tip';
import StatsTabs, { type Vue } from './stats-tabs';

const nf = (n: number) => n.toLocaleString('fr-FR');
const eur = (n: number) => `${nf(Math.round(n))} €`;
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);

export default function RightPanel({ cumul, cumulFailed, stats, statsFailed, statsLoading, period, inFeed, vue, onVue, keys, onRetry }: {
  cumul: CumulPayload | null; cumulFailed: boolean; stats: StatsPayload | null; statsFailed: boolean; statsLoading: boolean; period: Period; inFeed: number;
  vue: Vue; onVue: (v: Vue) => void; keys: boolean; onRetry: () => void;
}) {
  const t = stats?.totals;
  const day = cumul?.today;
  const statsStale = stats ? isCalcStale(stats.computed_at, STATS_MAX_AGE_MIN) : false;
  const periodRange = t ? eurRange(t.estimated_cost_eur_ht_low, t.estimated_cost_eur_ht_high) : null;
  const cumulRange = cumul ? eurRange(cumul.cost_eur_ht_low, cumul.cost_eur_ht_high) : null;
  const calc = stats && !statsFailed ? calcLabel(stats.computed_at, STATS_MAX_AGE_MIN) : null;
  const cumulCalc = cumul ? calcLabel(cumul.computed_at, CUMUL_MAX_AGE_MIN) : null;
  const stale = statsLoading && stats && !statsFailed ? ' term-stale' : '';
  const week = lastCompleteWeek(new Date());
  return (
    <aside className="term-col term-right">
      <section className="term-panel today" aria-labelledby="today-title">
        <div className="panel-head">
          <h2 className="term-panel-title" id="today-title">Aujourd&apos;hui</h2>
          <span className="live-badge"><span className="live-dot" aria-hidden="true" />LIVE</span>
        </div>
        {!day ? <p className="term-dim">{cumulFailed ? 'INDISPONIBLE' : '…'}</p> : (
          <div title={`Trains terminés depuis minuit (heure de Paris), recalculé toutes les 5 minutes.\n${breakdownText(day)}\n${nf(inFeed)} DANS LE FLUX EN CE MOMENT`}>
            <p className="today-row"><span><span className="term-dim">RÉGUL.</span> <strong>{pct(day.official_regularity_pct)}</strong></span><span>{nf(day.circulated)} <span className="term-dim">TRAINS TERMINÉS</span></span></p>
            <p className="today-row"><strong>{eur(day.estimated_cost_eur_ht)}</strong><span className="term-dim">HT</span></p>
            {day.estimated_cost_eur_ht_bon !== null && <p className="term-dim">DONT {eur(day.estimated_cost_eur_ht_bon)} EN BONS</p>}
          </div>
        )}
      </section>

      <section className={`term-panel period-panel${t && isSmallSample(t) ? ' term-small' : ''}`} aria-labelledby="period-title">
        <div className="panel-head">
          <h2 className="term-panel-title" id="period-title">Période</h2>
          {stats && !statsFailed && (
            <InfoTip label="Détails de la période">
              <p>RÉGULARITÉ APPROCHÉE : RETARDS PUBLIÉS PAR PAS DE 5′.</p>
              {windowLabel(period) && <p>{windowLabel(period)}</p>}
              {periodRange && <p>FOURCHETTE {periodRange} HT. {RANGE_HINT}</p>}
              {t && splitLabel(t.estimated_cost_eur_ht, t.estimated_cost_eur_ht_bon) && <p>{splitLabel(t.estimated_cost_eur_ht, t.estimated_cost_eur_ht_bon)}</p>}
              <p>PRIX HT {stats.assumptions.prices.map((p) => `${p.brand} ${nf(p.price_eur_ht)} €`).join(', ')} · OCCUPATION {nf(stats.assumptions.occupancy)}.</p>
              <p><a href="/methodologie" className="to-marey">MÉTHODOLOGIE →</a></p>
            </InfoTip>
          )}
        </div>
        {statsFailed ? <p className="term-dim">INDISPONIBLE</p> : !t || !stats ? <p className="term-dim">…</p> : (
          <div className={stale}>
            <p className={statsStale ? 'tone-late' : 'term-dim'}>
              {periodLabel(period)} · {rangeLabel(stats.from, stats.to)}{calc ? ` · ${calc}` : ''}
            </p>
            <dl className="kpi-row">
              <div title="Trains qui ont roulé (observés, non supprimés, avec un retard publié au terminus)"><dt>TRAINS</dt><dd>{nf(t.circulated)}</dd></div>
              <div><dt>RÉGUL.</dt><dd>{pct(t.official_regularity_pct)}</dd></div>
              <div><dt>SUPPR.</dt><dd>{pct(suppressionPct(t))}</dd></div>
              <div><dt>INDEMN.</dt><dd>{eur(t.estimated_cost_eur_ht)}</dd></div>
            </dl>
            {t.estimated_cost_eur_ht_bon !== null && <p className="term-dim kpi-bon">DONT {eur(t.estimated_cost_eur_ht_bon)} EN BONS</p>}
          </div>
        )}
        <StatsTabs stats={stats} failed={statsFailed} loading={statsLoading} vue={vue} onVue={onVue} keys={keys} onRetry={onRetry} />
      </section>

      <section className={cumul && isSmallSample(cumul) ? 'term-panel term-small' : 'term-panel'} aria-labelledby="cumul-title">
        <div className="panel-head">
          <h2 className="term-panel-title" id="cumul-title">Cumul depuis le 20/10</h2>
          {cumul && cumul.days > 0 && (
            <InfoTip label="Décomposition du cumul">
              <ul className="tip-list">
                {COUNT_KEYS.filter((k) => k === 'observed' || k === 'circulated' || cumul[k] > 0).map((k) => <li key={k}>{nf(cumul[k])} {COUNT_LABELS[k].short}</li>)}
              </ul>
              <p>{cumul.coverage_pct === null ? '—' : `${cumul.coverage_pct.toLocaleString('fr-FR')} %`} DU PRÉVU (trains terminés depuis le 20 octobre 2026 observés dans le flux).</p>
              <p>{cumul.by_brand.map((b) => `${b.brand} ${eur(b.cost_eur_ht)}`).join(' · ')}</p>
              {cumulRange && <p>FOURCHETTE {cumulRange} HT. {RANGE_HINT}</p>}
              {splitLabel(cumul.cost_eur_ht, cumul.cost_eur_ht_bon) && <p>{splitLabel(cumul.cost_eur_ht, cumul.cost_eur_ht_bon)}</p>}
              <p>OBSERVÉ SEULEMENT, SANS EXTRAPOLATION · AUJOURD&apos;HUI INCLUS.</p>
            </InfoTip>
          )}
        </div>
        {cumulFailed ? <p className="term-dim">INDISPONIBLE</p> : !cumul ? <p className="term-dim">…</p> : cumul.days === 0 ? <p className="term-dim">AUCUN JOUR TERMINÉ</p> : (
          <>
            <p className="big">{eur(cumul.cost_eur_ht)} <span className="big-unit term-dim">HT</span></p>
            {cumul.cost_eur_ht_bon !== null && <p className="term-dim">DONT {eur(cumul.cost_eur_ht_bon)} EN BONS</p>}
            {cumulCalc && <p className={isCalcStale(cumul.computed_at, CUMUL_MAX_AGE_MIN) ? 'tone-late' : 'term-dim'}>{cumulCalc}</p>}
          </>
        )}
      </section>
      <p className="week-link"><a href={`/semaine/${lastCompleteWeekId(new Date())}`} className="to-marey">BILAN SEMAINE {week} →</a></p>
    </aside>
  );
}
