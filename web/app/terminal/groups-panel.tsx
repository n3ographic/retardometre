import { TERMINUS_BUCKETS, bucketShares, isSmallSample, sortGroups, suppressionPct } from '../../lib/dashboard-model';
import type { StatsPayload } from '../../lib/stats';
import { RANGE_HINT, bucketBar, calcLabel, eurRange, periodLabel, type Period } from '../../lib/terminal-model';

const nf = (n: number) => n.toLocaleString('fr-FR');
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

function Bar({ buckets }: { buckets: Record<string, number> }) {
  const label = bucketShares(buckets).filter((s) => s.n > 0).map((s) => `${s.bucket} min : ${pct(s.pct)}`).join(', ') || 'aucun train';
  return (
    <span className="groups-bar" role="img" aria-label={`Retard au terminus : ${label}`} title={label}>
      {bucketBar(buckets, 12).map((s) => <span key={s.bucket} className={`seg-c s${s.i}`}>{'█'.repeat(s.len)}</span>)}
    </span>
  );
}

// Tableau par marque et par axe sur la période choisie ; il défile dans son panneau.
export default function GroupsPanel({ stats, failed, loading, period, onRetry }: {
  stats: StatsPayload | null; failed: boolean; loading: boolean; period: Period; onRetry: () => void;
}) {
  const groups = stats ? sortGroups(stats.groups) : [];
  return (
    <section className={`term-panel groups${loading && stats && !failed ? ' term-stale' : ''}`} aria-labelledby="groups-title">
      <h2 className="term-panel-title" id="groups-title">Marque × axe {periodLabel(period)}</h2>
      {failed ? (
        <p className="term-dim">INDISPONIBLE <button type="button" className="term-btn" onClick={onRetry}>RÉESSAYER</button></p>
      ) : !stats ? <p className="term-dim">…</p> : groups.length === 0 ? <p className="term-dim">AUCUN TRAIN SUR CETTE PÉRIODE</p> : (
        <>
          <div className="groups-scroll" tabIndex={0} role="region" aria-label="Tableau par marque et par axe">
            <table>
              <caption className="sr-only">Par marque et par axe</caption>
              <thead>
                <tr>
                  <th scope="col">Marque</th><th scope="col">Axe</th><th scope="col">Trains</th><th scope="col">Régul.</th>
                  <th scope="col">Suppr.</th><th scope="col">Retard terminus</th><th scope="col">Indemn.</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={`${g.brand}|${g.axis}`} className={isSmallSample(g) ? 'term-small' : undefined}>
                    <th scope="row">{g.brand}</th>
                    <td>{g.axis}</td>
                    <td>{nf(g.circulated)}{isSmallSample(g) && <span className="term-dim"> n&lt;30</span>}</td>
                    <td>{pct(g.official_regularity_pct)}</td>
                    <td>{pct(suppressionPct(g))}</td>
                    <td><Bar buckets={g.terminus_buckets} /></td>
                    <td title={eurRange(g.estimated_cost_eur_ht_low, g.estimated_cost_eur_ht_high) ? `Fourchette ${eurRange(g.estimated_cost_eur_ht_low, g.estimated_cost_eur_ht_high)}. ${RANGE_HINT}` : undefined}>{nf(Math.round(g.estimated_cost_eur_ht))} €</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="groups-foot term-dim">
            {TERMINUS_BUCKETS.map((b, i) => <span key={b}><span className={`seg-c s${i}`} aria-hidden="true">█</span> {b} </span>)}MIN <span className="term-dim">· RETARDS PUBLIÉS PAR PAS DE 5 MIN</span>
            {' · '}DU {day(stats.from)} AU {day(stats.to)} · RÉGULARITÉ APPROCHÉE · PAS DE 5′ · COLLECTE DEPUIS LE 20/10
            {' · '}PRIX HT {stats.assumptions.prices.map((p) => `${p.brand} ${nf(p.price_eur_ht)} €`).join(', ')} · OCCUPATION {nf(stats.assumptions.occupancy)}
            {calcLabel(stats.computed_at) && ` · ${calcLabel(stats.computed_at)}`}
          </p>
        </>
      )}
    </section>
  );
}
