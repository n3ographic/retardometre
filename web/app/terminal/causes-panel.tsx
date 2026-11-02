import { CAUSE_LABELS } from '../../lib/causes';
import type { StatsPayload } from '../../lib/stats';
import { calcLabel, charBar, periodLabel, type Period } from '../../lib/terminal-model';

const nf = (n: number) => n.toLocaleString('fr-FR');

// Retards d'au moins 5 min par cause déclarée sur la période ; à côté du tableau marque × axe.
export default function CausesPanel({ stats, failed, loading, period }: {
  stats: StatsPayload | null; failed: boolean; loading: boolean; period: Period;
}) {
  const rows = stats?.cause_breakdown ?? [];
  const maxCost = Math.max(0, ...rows.map((c) => c.cost_eur_ht));
  const maxTrains = Math.max(0, ...rows.map((c) => c.trains));
  const share = (c: (typeof rows)[number]) => (maxCost > 0 ? (c.cost_eur_ht / maxCost) * 100 : (c.trains / maxTrains) * 100);
  return (
    <section className={`term-panel causes${loading && stats && !failed ? ' term-stale' : ''}`} aria-labelledby="causes-title">
      <h2 className="term-panel-title" id="causes-title">Causes {periodLabel(period)}</h2>
      {failed ? <p className="term-dim">INDISPONIBLE</p> : !stats ? <p className="term-dim">…</p> : rows.length === 0 ? <p className="term-dim">AUCUN RETARD SUR CETTE PÉRIODE</p> : (
        <div className="causes-scroll">
          <table>
            <caption className="sr-only">Retards d’au moins 5 minutes par cause déclarée</caption>
            <thead>
              <tr><th scope="col">Cause</th><th scope="col"><span className="sr-only">Part des indemnités</span></th><th scope="col">Trains</th><th scope="col">Moy.</th><th scope="col">Indemn.</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.category}>
                  <th scope="row" title={CAUSE_LABELS[c.category]?.long ?? c.category}>{CAUSE_LABELS[c.category]?.short ?? c.category.toUpperCase()}</th>
                  <td className="causes-bar" aria-hidden="true">{charBar(share(c), 10)}</td>
                  <td>{nf(c.trains)}</td>
                  <td>{c.avg_delay_min}′</td>
                  <td>{nf(Math.round(c.cost_eur_ht))} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="term-dim groups-foot">CAUSE DÉCLARÉE PAR SNCF · CLASSÉE PAR NOS RÈGLES · TRAINS ≥ 5′{stats && !failed && calcLabel(stats.computed_at) ? ` · ${calcLabel(stats.computed_at)}` : ''}</p>
    </section>
  );
}
