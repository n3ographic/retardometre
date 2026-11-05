import { bucketShares, isSmallSample, suppressionPct } from '../../lib/dashboard-model';
import { COUNT_KEYS, COUNT_LABELS, breakdownText } from '../../lib/counts';
import type { CumulPayload } from '../../lib/cumul';
import { lastCompleteWeekId, weekDays, weekNum } from '../../lib/weekly';
import { splitLabel, type StatsPayload } from '../../lib/stats';
import { CUMUL_MAX_AGE_MIN, RANGE_HINT, STATS_MAX_AGE_MIN, calcLabel, columnCalc, deltaPts, eurRange, eurShort, isCalcStale, periodLabel, rangeLabel, regTone, windowLabel, type Period } from '../../lib/terminal-model';
import InfoTip from './info-tip';
import StatsTabs, { type Vue } from './stats-tabs';

const nf = (n: number) => n.toLocaleString('fr-FR');
const eur = (n: number) => `${nf(Math.round(n))} €`;
// Part en bons : « 100 % EN BONS » quand elle couvre tout le montant, sinon « DONT X EN BONS » ; null sans la mesure.
const bons = (total: number, bon: number | null, fmt: (n: number) => string) =>
  (bon === null ? null : total > 0 && Math.round(bon) >= Math.round(total) ? '100 % EN BONS' : `DONT ${fmt(bon)} EN BONS`);
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
  const weekId = lastCompleteWeekId(new Date());
  const week = weekNum(weekId);
  // Une seule heure visible : le calcul le plus récent ; chaque bloc donne la sienne dans son ⓘ.
  const head = columnCalc(stats && !statsFailed ? stats.computed_at : undefined, cumul?.computed_at);
  return (
    <aside className="term-col term-right">
      {head && (
        <p className={`col-head ${head.stale ? 'tone-late' : 'term-dim'}`}
          title="Chaque bloc a son propre cache : le jour et le cumul sont recalculés toutes les 5 min, la période (jours complets, figée dans la journée) toutes les 15 min. Heure de chaque bloc dans son ⓘ.">
          {head.label}{head.stale ? ' · PÉRIMÉ, MISE À JOUR EN ÉCHEC' : ''}
        </p>
      )}
      <section className="term-panel today" aria-labelledby="today-title">
        <div className="panel-head">
          <h2 className="term-panel-title" id="today-title">Aujourd&apos;hui</h2>
          <span className="live-badge"><span className="live-dot" aria-hidden="true" />LIVE</span>
          {day && (
            <InfoTip label="Détails du jour">
              <p>TRAINS TERMINÉS DEPUIS MINUIT (HEURE DE PARIS), RECALCULÉ TOUTES LES 5 MINUTES.</p>
              <p>{breakdownText(day)}</p>
              <p>{nf(inFeed)} DANS LE FLUX EN CE MOMENT.</p>
              {splitLabel(day.estimated_cost_eur_ht, day.estimated_cost_eur_ht_bon) && <p>{splitLabel(day.estimated_cost_eur_ht, day.estimated_cost_eur_ht_bon)}</p>}
              {t && <p>ÉCART VS {periodLabel(period)} : LA JOURNÉE EN COURS N’EST PAS COMPARABLE À DES JOURNÉES COMPLÈTES : SEULS LES TRAINS DÉJÀ TERMINÉS COMPTENT, LE RESTE DE LA JOURNÉE PEUT CHANGER LE CHIFFRE. INDICATION SEULEMENT.</p>}
              {cumulCalc && <p>{cumulCalc}</p>}
            </InfoTip>
          )}
        </div>
        {!day ? <p className="term-dim">{cumulFailed ? 'INDISPONIBLE' : '…'}</p> : (
          <dl className="kpi-row kpi-today">
            <div>
              <dt>RÉGUL.</dt><dd className={regTone(day.official_regularity_pct)}>{pct(day.official_regularity_pct)}</dd>
              {t && deltaPts(day.official_regularity_pct, t.official_regularity_pct) && (
                <dd className="kpi-sub" title={`Régularité du jour moins celle de la période ${periodLabel(period)} (${pct(t.official_regularity_pct)}). Journée en cours, pas encore comparable à des journées complètes.`}>
                  {deltaPts(day.official_regularity_pct, t.official_regularity_pct)} VS {periodLabel(period)}
                </dd>
              )}
            </div>
            <div className="kpi-right">
              <dt>INDEMN. HT</dt><dd>{eur(day.estimated_cost_eur_ht)}</dd>
              {bons(day.estimated_cost_eur_ht, day.estimated_cost_eur_ht_bon, eur) && <dd className="kpi-sub term-dim">{bons(day.estimated_cost_eur_ht, day.estimated_cost_eur_ht_bon, eur)}</dd>}
            </div>
          </dl>
        )}
        {day && <p className="kpi-foot term-dim">SUR {nf(day.circulated)} TRAINS TERMINÉS</p>}
      </section>

      <section className={`term-panel period-panel${t && isSmallSample(t) ? ' term-small' : ''}`} aria-labelledby="period-title">
        <div className="panel-head">
          <h2 className="term-panel-title" id="period-title">Période {periodLabel(period)}</h2>
          {!statsFailed && t && stats && (
            <div className={`period-line ${statsStale ? 'tone-late' : 'term-dim'}`}>
              <span>{rangeLabel(stats.from, stats.to)}</span>
              <InfoTip label="Détails de la période">
                <p>RÉGULARITÉ APPROCHÉE : RETARDS PUBLIÉS PAR PAS DE 5′.</p>
                {windowLabel(period) && <p>{windowLabel(period)}</p>}
                {splitLabel(t.estimated_cost_eur_ht, t.estimated_cost_eur_ht_bon) && <p>{splitLabel(t.estimated_cost_eur_ht, t.estimated_cost_eur_ht_bon)}</p>}
                {periodRange && <p>FOURCHETTE {periodRange} HT. {RANGE_HINT}</p>}
                <p>PRIX HT {stats.assumptions.prices.map((p) => `${p.brand} ${nf(p.price_eur_ht)} €`).join(', ')} · OCCUPATION {nf(stats.assumptions.occupancy)}.</p>
                {calc && <p>{calc}</p>}
                <p><a href="/methodologie" className="to-marey">MÉTHODOLOGIE →</a></p>
              </InfoTip>
            </div>
          )}
        </div>
        {statsFailed ? <p className="term-dim">INDISPONIBLE</p> : !t || !stats ? <p className="term-dim">…</p> : (
          <div className={stale}>
            <dl className="kpi-row kpi-grid">
              <div title="Trains qui ont roulé (observés, non supprimés, avec un retard publié au terminus)"><dt>TRAINS</dt><dd>{nf(t.circulated)}</dd></div>
              <div><dt>RÉGUL.</dt><dd className={regTone(t.official_regularity_pct)}>{pct(t.official_regularity_pct)}</dd></div>
              <div><dt>SUPPR.</dt><dd>{pct(suppressionPct(t))}</dd></div>
              <div title={splitLabel(t.estimated_cost_eur_ht, t.estimated_cost_eur_ht_bon) ?? eur(t.estimated_cost_eur_ht)}><dt>INDEMN. HT</dt><dd>{eurShort(t.estimated_cost_eur_ht)}</dd>
                {bons(t.estimated_cost_eur_ht, t.estimated_cost_eur_ht_bon, eurShort) && <dd className="kpi-sub term-dim">{bons(t.estimated_cost_eur_ht, t.estimated_cost_eur_ht_bon, eurShort)}</dd>}</div>
            </dl>
          </div>
        )}
        <StatsTabs stats={stats} failed={statsFailed} loading={statsLoading} vue={vue} onVue={onVue} keys={keys} onRetry={onRetry} />
        {t && !statsFailed && (
          <Spread terminus={t.terminus_buckets} stops={t.stop_buckets} className={stale} />
        )}
      </section>

      <section className={`term-panel cumul${cumul && isSmallSample(cumul) ? ' term-small' : ''}`} aria-labelledby="cumul-title">
        <div className="panel-head">
          <h2 className="term-panel-title" id="cumul-title">Cumul depuis le 20/10</h2>
          {cumul && cumul.days > 0 && (
            <InfoTip label="Décomposition du cumul">
              <p>{splitLabel(cumul.cost_eur_ht, cumul.cost_eur_ht_bon) ?? `${eur(cumul.cost_eur_ht)} HT`}</p>
              <ul className="tip-list">
                {COUNT_KEYS.filter((k) => k === 'observed' || k === 'circulated' || cumul[k] > 0).map((k) => <li key={k}>{nf(cumul[k])} {COUNT_LABELS[k].short}</li>)}
              </ul>
              <p>{cumul.coverage_pct === null ? '—' : `${cumul.coverage_pct.toLocaleString('fr-FR')} %`} DU PRÉVU (trains terminés depuis le 20 octobre 2026 observés dans le flux).</p>
              <p>{cumul.by_brand.map((b) => `${b.brand} ${eur(b.cost_eur_ht)}`).join(' · ')}</p>
              {cumulRange && <p>FOURCHETTE {cumulRange} HT. {RANGE_HINT}</p>}
              <p>OBSERVÉ SEULEMENT, SANS EXTRAPOLATION · AUJOURD&apos;HUI INCLUS.</p>
              {cumulCalc && <p>{cumulCalc}</p>}
            </InfoTip>
          )}
        </div>
        {cumulFailed ? <p className="term-dim">INDISPONIBLE</p> : !cumul ? <p className="term-dim">…</p> : cumul.days === 0 ? <p className="term-dim">AUCUN JOUR TERMINÉ</p> : (
          <>
            <p className="big" title={splitLabel(cumul.cost_eur_ht, cumul.cost_eur_ht_bon) ?? `${eur(cumul.cost_eur_ht)} HT`}>{eurShort(cumul.cost_eur_ht)} <span className="big-unit term-dim">HT</span></p>
            {bons(cumul.cost_eur_ht, cumul.cost_eur_ht_bon, eurShort) && <p className="term-dim">{bons(cumul.cost_eur_ht, cumul.cost_eur_ht_bon, eurShort)}</p>}
          </>
        )}
      </section>
      <a href={`/semaine/${weekId}`} className="week-link">
        <span>BILAN SEMAINE {week}</span>
        <span className="term-dim">{weekDays(weekId).join(' → ')}</span>
        <span aria-hidden="true">→</span>
      </a>
    </aside>
  );
}

// Répartition des retards de la période : une ligne par tranche (couleur de la légende de la carte), part des trains au
// terminus et part des arrêts desservis. Les arrêts supprimés sont hors répartition (infobulle).
function Spread({ terminus, stops, className }: { terminus: Record<string, number>; stops: Record<string, number>; className: string }) {
  const t = bucketShares(terminus), s = bucketShares(stops);
  const nT = t.reduce((n, x) => n + x.n, 0), nS = s.reduce((n, x) => n + x.n, 0);
  if (nT === 0) return null;
  const p = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 ? 1 : 0 })} %`;
  return (
    <table className={`spread${className}`} title={`${nf(nT)} trains au terminus · ${nf(nS)} arrêts desservis${stops.cancelled ? ` · ${nf(stops.cancelled)} arrêts supprimés, hors répartition` : ''}`}>
      <caption className="sr-only">Répartition des retards sur la période, en minutes</caption>
      <thead><tr><th scope="col">Retard</th><th scope="col">Au terminus</th><th scope="col">Aux arrêts</th></tr></thead>
      <tbody>
        {t.map((x, i) => (
          <tr key={x.bucket} className={x.n === 0 && s[i].n === 0 ? 'term-dim' : undefined}>
            <th scope="row"><span className={`seg-c s${i}`} aria-hidden="true">■</span> {x.bucket}′</th>
            <td>{p(x.pct)}</td>
            <td>{nS === 0 ? '—' : p(s[i].pct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
