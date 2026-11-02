import { isSmallSample, suppressionPct } from '../../lib/dashboard-model';
import { COUNT_KEYS, COUNT_LABELS, breakdownText } from '../../lib/counts';
import type { CumulPayload } from '../../lib/cumul';
import { lastCompleteWeek } from '../../lib/weekly';
import type { StatsPayload } from '../../lib/stats';
import { RANGE_HINT, axisRegularity, brandSplit, calcLabel, charBar, eurRange, periodLabel, windowLabel, type Period } from '../../lib/terminal-model';

const nf = (n: number) => n.toLocaleString('fr-FR');
const AXIS_SHORT: Record<string, string> = { ATLANTIQUE: 'ATL', EST: 'EST', INTERSECTEURS: 'INTER', NORD: 'NORD', SUD_EST: 'S-EST' };
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const BAR_W = 20;
// Barre empilée : la première marque prend sa part, la seconde le reste (une seule marque = toute la barre).
const stackLens = (shares: number[]) => (shares.length < 2 ? [BAR_W] : [Math.round((shares[0] / 100) * BAR_W), BAR_W - Math.round((shares[0] / 100) * BAR_W)]);
const tone = (p: number | null) => (p === null ? 'term-dim' : p >= 80 ? 'tone-ontime' : p >= 60 ? 'tone-late' : p >= 40 ? 'tone-strong' : 'tone-severe');

// Une ligne par catégorie de comptage, pour l'infobulle de la décomposition.
const COUNTS_HINT = COUNT_KEYS.map((k) => `${COUNT_LABELS[k].short} : ${COUNT_LABELS[k].long}`).join('\n');

export default function RightPanel({ cumul, cumulFailed, stats, statsFailed, statsLoading, period, inFeed }: {
  cumul: CumulPayload | null; cumulFailed: boolean; stats: StatsPayload | null; statsFailed: boolean; statsLoading: boolean; period: Period; inFeed: number;
}) {
  const t = stats?.totals;
  const day = cumul?.today;
  const statsCalc = stats && !statsFailed ? calcLabel(stats.computed_at) : null;
  const periodRange = t ? eurRange(t.estimated_cost_eur_ht_low, t.estimated_cost_eur_ht_high) : null;
  const cumulRange = cumul ? eurRange(cumul.cost_eur_ht_low, cumul.cost_eur_ht_high) : null;
  const split = stats ? brandSplit(stats.groups) : [];
  const stale = statsLoading && stats && !statsFailed ? ' term-stale' : '';
  return (
    <aside className="term-col">
      <section className={`term-panel period-panel${t && isSmallSample(t) ? ' term-small' : ''}${stale}`}>
        <h2 className="term-panel-title">Période {periodLabel(period)}</h2>
        {statsFailed ? <p className="term-dim">INDISPONIBLE</p> : !t ? <p className="term-dim">…</p> : (
          <>
          <dl className="kpi-list">
            <dt title={COUNT_LABELS.circulated.long}>TRAINS (ONT ROULÉ)</dt><dd>{nf(t.circulated)}</dd>
            <dt>RÉGUL.</dt><dd>{pct(t.official_regularity_pct)}</dd>
            <dt>SUPPR.</dt><dd>{pct(suppressionPct(t))}</dd>
            <dt>INDEMN.</dt><dd>{nf(Math.round(t.estimated_cost_eur_ht))} € HT</dd>
          </dl>
          {periodRange && <p className="term-dim" title={RANGE_HINT}>FOURCHETTE {periodRange} HT</p>}
          {windowLabel(period) && <p className="term-dim">{windowLabel(period)}</p>}
          </>
        )}
        {day && (
          <p className="today-line" title={`Trains terminés depuis minuit (heure de Paris), recalculé toutes les 5 minutes.\n${breakdownText(day)}\n${nf(inFeed)} DANS LE FLUX EN CE MOMENT (EN ROUTE OU SUR LE POINT DE PARTIR)`}>
            AUJOURD&apos;HUI · {nf(day.circulated)} TR. TERMINÉS · RÉGUL. {pct(day.official_regularity_pct)} · {nf(Math.round(day.estimated_cost_eur_ht))} € HT
          </p>
        )}
        {statsCalc && <p className="term-dim">{statsCalc}</p>}
        <p><a href="/semaine" className="to-marey">BILAN SEMAINE {lastCompleteWeek(new Date())} →</a></p>
      </section>
      <section className={cumul && isSmallSample(cumul) ? 'term-panel term-small' : 'term-panel'}>
        <h2 className="term-panel-title">Indemn. cumul</h2>
        {cumulFailed ? <p className="term-dim">INDISPONIBLE</p> : !cumul ? <p className="term-dim">…</p> : cumul.days === 0 ? <p className="term-dim">AUCUN JOUR TERMINÉ</p> : (
          <>
            <p className="big">{nf(Math.round(cumul.cost_eur_ht))} €</p>
            {cumulRange && <p className="term-dim" title={RANGE_HINT}>FOURCHETTE {cumulRange} HT</p>}
            <p className="term-dim" title={COUNTS_HINT}>{breakdownText(cumul)}</p>
            <p className="term-dim">HT · <span title="Part des trains prévus observés dans le flux temps réel, trains terminés depuis le 20 octobre 2026">{cumul.coverage_pct === null ? '—' : `${cumul.coverage_pct.toLocaleString('fr-FR')} %`} DU PRÉVU</span></p>
            {cumul.by_brand.map((b) => <p key={b.brand}>{b.brand} {nf(Math.round(b.cost_eur_ht))} €</p>)}
            <p className="term-dim">OBSERVÉ SEULEMENT, SANS EXTRAPOLATION · DEPUIS LE 20/10, AUJOURD&apos;HUI INCLUS</p>
            {calcLabel(cumul.computed_at) && <p className="term-dim">{calcLabel(cumul.computed_at)}</p>}
          </>
        )}
      </section>
      <section className={`term-panel${stale}`}>
        <h2 className="term-panel-title">Régularité {periodLabel(period)}</h2>
        {statsFailed ? <p className="term-dim">INDISPONIBLE</p> : !stats ? <p className="term-dim">…</p> : (
          <ul className="reg-list">
            {axisRegularity(stats.groups).map((a) => (
              <li key={a.axis} className={a.small ? 'term-small' : undefined}>
                <span className="reg-axis" title={a.axis}>{AXIS_SHORT[a.axis] ?? a.axis.slice(0, 5)}</span>
                <span className={`reg-bar ${tone(a.pct)}`} aria-hidden="true">{charBar(a.pct, 10)}</span>
                <span>{a.pct === null ? '—' : a.pct.toLocaleString('fr-FR', { minimumFractionDigits: 1 })}</span>
                {a.small && <span className="term-dim"> n&lt;30</span>}
              </li>
            ))}
          </ul>
        )}
        {stats && !statsFailed && <p className="term-dim">APPROCHÉE · RETARDS PAR PAS DE 5′</p>}
        {statsCalc && <p className="term-dim">{statsCalc}</p>}
      </section>
      <section className={`term-panel${stale}`}>
        <h2 className="term-panel-title">INOUI / OUIGO {periodLabel(period)}</h2>
        {statsFailed ? <p className="term-dim">INDISPONIBLE</p> : !stats ? <p className="term-dim">…</p> : split.length === 0 ? <p className="term-dim">AUCUN TRAIN</p> : (
          <>
            <dl className="brand-split">
              {split.map((b) => (
                <div key={b.brand} className={b.small ? 'term-small' : undefined}>
                  <dt className={`brand-${b.brand.toLowerCase()}`}>{b.brand}</dt>
                  <dd>{nf(b.circulated)} TR · {pct(b.pct)} · {nf(Math.round(b.cost))} €</dd>
                </div>
              ))}
            </dl>
            {([['TRAINS', 'trains_share'], ['INDEMN.', 'cost_share']] as const).map(([label, key]) => {
              const lens = stackLens(split.map((b) => b[key]));
              return (
                <p key={key} className="brand-bar">
                  <span className="term-dim">{label}</span>{' '}
                  {split.map((b, i) => <span key={b.brand} className={`brand-${b.brand.toLowerCase()}`} aria-hidden="true">{'█'.repeat(lens[i])}</span>)}
                  <span className="sr-only">{split.map((b) => `${b.brand} ${b[key]} %`).join(', ')}</span>
                </p>
              );
            })}
          </>
        )}
        {statsCalc && <p className="term-dim">{statsCalc}</p>}
      </section>
    </aside>
  );
}
