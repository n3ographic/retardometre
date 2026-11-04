'use client';

import { useEffect, useRef, useState } from 'react';
import { CAUSE_LABELS } from '../../lib/causes';
import { SAMPLE_MIN, bucketShares, isSmallSample, sortGroups, suppressionPct } from '../../lib/dashboard-model';
import type { StatsPayload } from '../../lib/stats';
import { RANGE_HINT, axisRegularity, brandSplit, charBar, eurRange, eurShort, regTone } from '../../lib/terminal-model';
import { typing } from './command-bar';

export type Vue = 'axes' | 'marques' | 'croise' | 'causes';
const TABS: { vue: Vue; label: string; key: string }[] = [
  { vue: 'axes', label: 'AXES', key: 'A' }, { vue: 'marques', label: 'MARQUES', key: 'M' },
  { vue: 'croise', label: 'CROISÉ', key: 'X' }, { vue: 'causes', label: 'CAUSES', key: 'K' },
];
export const parseVue = (v: string | null): Vue => TABS.find((t) => t.vue === v)?.vue ?? 'axes';

const TOP_CAUSES = 5;
const nf = (n: number) => n.toLocaleString('fr-FR');
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
const AXIS_SHORT: Record<string, string> = { ATLANTIQUE: 'ATL', EST: 'EST', INTERSECTEURS: 'INTER', NORD: 'NORD', SUD_EST: 'S-EST' };
const axisName = (a: string) => AXIS_SHORT[a] ?? a.slice(0, 5);
const tone = regTone;
const BAR_W = 20;
// Barre empilée : la première marque prend sa part, la seconde le reste (une seule marque = toute la barre).
const stackLens = (shares: number[]) => (shares.length < 2 ? [BAR_W] : [Math.round((shares[0] / 100) * BAR_W), BAR_W - Math.round((shares[0] / 100) * BAR_W)]);

// Les quatre vues de la période dans un seul panneau. Les touches A, M, X, K changent d'onglet, sauf pendant une saisie
// ou quand la fiche d'un train ou d'une gare est ouverte (M y ouvre le Marey).
export default function StatsTabs({ stats, failed, loading, vue, onVue, keys, onRetry }: {
  stats: StatsPayload | null; failed: boolean; loading: boolean; vue: Vue; onVue: (v: Vue) => void; keys: boolean; onRetry: () => void;
}) {
  const [more, setMore] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
      const hit = TABS.find((t) => t.key === e.key.toUpperCase());
      if (hit) onVue(hit.vue);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, onVue]);
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + TABS.length) % TABS.length;
    onVue(TABS[n].vue);
    tabs.current[n]?.focus();
  };
  return (
    <div className={`stab${loading && stats && !failed ? ' term-stale' : ''}`}>
      <div className="stab-tabs" role="tablist" aria-label="Vue de la période">
        {TABS.map((t, i) => (
          <button key={t.vue} type="button" role="tab" id={`stab-${t.vue}`} aria-selected={vue === t.vue} aria-controls="stab-panel"
            aria-keyshortcuts={t.key} title={`Raccourci : ${t.key}`} tabIndex={vue === t.vue ? 0 : -1} ref={(el) => { tabs.current[i] = el; }}
            onClick={() => onVue(t.vue)} onKeyDown={(e) => move(e, i)}>{t.label}</button>
        ))}
      </div>
      <div className="stab-body" id="stab-panel" role="tabpanel" aria-labelledby={`stab-${vue}`}>
        {failed ? <p className="term-dim">INDISPONIBLE <button type="button" className="term-btn" onClick={onRetry}>RÉESSAYER</button></p>
          : !stats ? <p className="term-dim">…</p>
          : vue === 'axes' ? <Axes stats={stats} />
          : vue === 'marques' ? <Marques stats={stats} />
          : vue === 'croise' ? <Croise stats={stats} />
          : <Causes stats={stats} more={more} onMore={() => setMore((m) => !m)} />}
      </div>
    </div>
  );
}

function Axes({ stats }: { stats: StatsPayload }) {
  const rows = axisRegularity(stats.groups);
  if (rows.length === 0) return <p className="term-dim">AUCUN TRAIN</p>;
  return (
    <table className="stab-table">
      <caption className="sr-only">Régularité, suppressions et indemnités par axe</caption>
      <thead><tr><th scope="col">Axe</th><th scope="col">Régul.</th><th scope="col"><span className="sr-only">Barre</span></th><th scope="col">Suppr.</th><th scope="col">Indemn.</th></tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.axis} className={a.small ? 'term-small' : undefined} title={a.small ? `${a.axis} : moins de ${SAMPLE_MIN} trains` : a.axis}>
            <th scope="row">{axisName(a.axis)}</th>
            <td className={tone(a.pct)}>{a.pct === null ? '—' : a.pct.toLocaleString('fr-FR', { minimumFractionDigits: 1 })}</td>
            <td className={`stab-bar ${tone(a.pct)}`} aria-hidden="true">{charBar(a.pct, 8)}</td>
            <td>{pct(a.suppr_pct)}</td>
            <td>{eurShort(a.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Marques({ stats }: { stats: StatsPayload }) {
  const split = brandSplit(stats.groups);
  if (split.length === 0) return <p className="term-dim">AUCUN TRAIN</p>;
  return (
    <>
      <dl className="brand-split">
        {split.map((b) => (
          <div key={b.brand} className={b.small ? 'term-small' : undefined}>
            <dt className={`brand-${b.brand.toLowerCase()}`}>{b.brand}</dt>
            <dd>{nf(b.circulated)} TR · {pct(b.pct)} · {eurShort(b.cost)}</dd>
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
  );
}

// Retard au terminus : une ligne de texte pour l'infobulle de la ligne (la barre colorée n'a plus de place ici).
function terminusText(buckets: Record<string, number>) {
  return bucketShares(buckets).filter((s) => s.n > 0).map((s) => `${s.bucket} min : ${pct(s.pct)}`).join(', ') || 'aucun train';
}

function Croise({ stats }: { stats: StatsPayload }) {
  const groups = sortGroups(stats.groups);
  if (groups.length === 0) return <p className="term-dim">AUCUN TRAIN SUR CETTE PÉRIODE</p>;
  return (
    <table className="stab-table">
      <caption className="sr-only">Par marque et par axe</caption>
      <thead><tr><th scope="col">Marque</th><th scope="col">Axe</th><th scope="col">Trains</th><th scope="col">Régul.</th><th scope="col">Indemn.</th></tr></thead>
      <tbody>
        {groups.map((g) => {
          const range = eurRange(g.estimated_cost_eur_ht_low, g.estimated_cost_eur_ht_high);
          return (
            <tr key={`${g.brand}|${g.axis}`} className={isSmallSample(g) ? 'term-small' : undefined}
              title={`${g.brand} ${g.axis} · SUPPR. ${pct(suppressionPct(g))} · RETARD AU TERMINUS : ${terminusText(g.terminus_buckets)}${range ? ` · FOURCHETTE ${range}. ${RANGE_HINT}` : ''}`}>
              <th scope="row" className={`brand-${g.brand.toLowerCase()}`}>{g.brand === 'OUIGO' ? 'OG' : 'IN'}</th>
              <td>{axisName(g.axis)}</td>
              <td>{nf(g.circulated)}{isSmallSample(g) && <span className="term-dim"> n&lt;{SAMPLE_MIN}</span>}</td>
              <td>{pct(g.official_regularity_pct)}</td>
              <td>{eurShort(g.estimated_cost_eur_ht)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Causes({ stats, more, onMore }: { stats: StatsPayload; more: boolean; onMore: () => void }) {
  const rows = stats.cause_breakdown;
  if (rows.length === 0) return <p className="term-dim">AUCUN RETARD SUR CETTE PÉRIODE</p>;
  const head = rows.slice(0, TOP_CAUSES), rest = rows.slice(TOP_CAUSES);
  // Ordinateur : toutes les causes (la place est là). Mobile : les 5 premières, puis AUTRES (N) dépliable (CSS).
  const line = (c: (typeof rows)[number], extra = false) => (
    <tr key={c.category} className={extra ? `cause-extra${more ? ' open' : ''}` : undefined}>
      <th scope="row" title={CAUSE_LABELS[c.category]?.long ?? c.category}>{CAUSE_LABELS[c.category]?.short ?? c.category.toUpperCase()}</th>
      <td>{nf(c.trains)}</td><td>{c.avg_delay_min}′</td><td>{eurShort(c.cost_eur_ht)}</td>
    </tr>
  );
  return (
    <table className="stab-table">
      <caption className="sr-only">Retards d’au moins 5 minutes par cause déclarée, trains, retard moyen, indemnités</caption>
      <thead><tr><th scope="col">Cause</th><th scope="col">Trains</th><th scope="col">Moy.</th><th scope="col">Indemn.</th></tr></thead>
      <tbody>
        {head.map((c) => line(c))}
        {rest.length > 0 && (
          <>
            <tr className="stab-more-row">
              <th scope="row" colSpan={3}>
                <button type="button" className="stab-more" aria-expanded={more} onClick={onMore}>AUTRES ({rest.length}) {more ? '▾' : '▸'}</button>
              </th>
              <td>{eurShort(rest.reduce((s, c) => s + c.cost_eur_ht, 0))}</td>
            </tr>
            {rest.map((c) => line(c, true))}
          </>
        )}
      </tbody>
    </table>
  );
}
