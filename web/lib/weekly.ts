import { CAUSE_LABELS } from './causes';
import type { Counts } from './counts';
import { isSmallSample, suppressionPct } from './dashboard-model';
import { shapeStats, type Price, type Scale, type StatRow } from './stats';
import { axisRegularity, brandSplit } from './terminal-model';

// Bilan hebdomadaire (/semaine/2026-W44) : ligne figée de weekly_reports mise en forme côté serveur.
// Toutes les phrases sont tirées de chiffres affichés sur la page, jamais inventées.
export type TrainDay = [date: string, observed: boolean, cancelled: boolean | null, delay_s: number | null];
export type WeekPayload = {
  from: string; to: string; monday: string; days: number;
  stats: [string, string, string, number | string][];
  by_day: { date: string; m: Record<string, number | string> | null }[];
  prices: Price[]; scale: Scale[];
  train: { number: string; counted: number; ok: number; delay_sum_s: number; brand: string; axis: string; origin: string | null; dest: string | null; days: TrainDay[] } | null;
  heatmap: [dow: number, hour: number, n: number, avg_s: number][] | null;
};
export type WeekRow = { week: string; monday: string; payload: WeekPayload; computed_at: string };

export const WEEK_RE = /^\d{4}-W\d{2}$/;
export const weekNum = (week: string) => Number(week.slice(-2));
const DOW = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dayLabel = (d: string) => `${DOW[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]} ${ddmm(d)}`;
const pct1 = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);
const fr1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf = (n: number) => n.toLocaleString('fr-FR');
const causeShort = (c: string) => CAUSE_LABELS[c]?.short ?? c.toUpperCase();
const causeLong = (c: string) => CAUSE_LABELS[c]?.long ?? c;

// Semaine ISO complète la plus récente à l'heure de Paris, décalée de 7 h : le bilan du lundi n'existe qu'après la tâche
// de 05:00 UTC (06:00 l'hiver, 07:00 l'été).
export function lastCompleteWeek(now: Date): number {
  const d = new Date(now.getTime() - 7 * 3600_000 - 7 * 86_400_000);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // jeudi de la semaine ISO
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

type Delta = { value: number; unit: '%' | 'PT'; good: boolean; perDay?: boolean } | null;
// Variation : en % pour un volume, en points pour un taux ; « good » colore la flèche (une hausse de régularité est bonne).
// Deux semaines de longueurs différentes (S43 : 6 jours) : volumes comparés par jour.
const deltaPct = (cur: number, prev: number | undefined, higherIsGood: boolean, days?: [number, number]): Delta => {
  if (prev === undefined || prev === 0) return null;
  const perDay = days !== undefined && days[0] !== days[1];
  const [c, p] = perDay ? [cur / days[0], prev / days[1]] : [cur, prev];
  return { value: Math.round(((c - p) / p) * 1000) / 10, unit: '%', good: (c >= p) === higherIsGood, perDay };
};
const deltaPt = (cur: number | null, prev: number | null | undefined, higherIsGood: boolean): Delta =>
  cur === null || prev === null || prev === undefined ? null : { value: Math.round((cur - prev) * 10) / 10, unit: 'PT', good: (cur >= prev) === higherIsGood };

function totalsOf(p: WeekPayload) {
  const rows: StatRow[] = p.stats.map(([brand, axis, metric, n]) => ({ brand, axis, metric, n: Number(n) }));
  return shapeStats(rows, p.prices, p.scale, { from: p.from, to: p.to });
}

// Bilan figé avant le 04/11/2026 : part en bons et écart du plafond international, recalculés à part sans toucher aux totaux.
export type WeekExtra = { bon: number | null; intl_cap: number | null };
export const INTL_CAP_FROM = '04/11';
export const BON_SHARE_KEY = 30; // au-delà, phrase « À RETENIR » sur la part en bons

export function shapeWeek(row: WeekRow, prev: WeekRow | null, extra: WeekExtra | null = null) {
  const p = row.payload;
  const s = totalsOf(p);
  const t = s.totals;
  const pt = prev ? totalsOf(prev.payload).totals : null;
  const supp = suppressionPct(t);
  const counts: Counts = { observed: t.observed, circulated: t.circulated, cancelled: t.cancelled, no_terminus: t.no_terminus, aberrant: t.aberrant };

  const days2: [number, number] | undefined = prev ? [p.days, prev.payload.days] : undefined;
  const kpis = {
    trains: { value: t.circulated, delta: deltaPct(t.circulated, pt?.circulated, true, days2) },
    regularity: { value: t.official_regularity_pct, delta: deltaPt(t.official_regularity_pct, pt?.official_regularity_pct, true) },
    cost: { value: t.estimated_cost_eur_ht, low: t.estimated_cost_eur_ht_low, high: t.estimated_cost_eur_ht_high, delta: deltaPct(t.estimated_cost_eur_ht, pt?.estimated_cost_eur_ht, false, days2),
      bon: t.estimated_cost_eur_ht_bon ?? extra?.bon ?? null },
    suppressions: { value: supp, n: t.cancelled, delta: deltaPt(supp, pt ? suppressionPct(pt) : undefined, false) },
  };

  // Jours : régularité et cause la plus citée (hors « sans cause ») ; pire et meilleur parmi les jours d'au moins 30 trains.
  const days = p.by_day.map(({ date, m }) => {
    const get = (k: string) => Number(m?.[k] ?? 0);
    const causes = Object.keys(m ?? {}).filter((k) => k.startsWith('cause:') && k !== 'cause:sans_cause')
      .sort((a, b) => get(b) - get(a) || a.localeCompare(b));
    return { date, label: dayLabel(date), circulated: get('circulated'), pct: pct1(get('on_time_official'), get('circulated')), cause: causes[0]?.slice(6) ?? null };
  });
  const ranked = days.filter((d) => d.pct !== null && !isSmallSample(d)).sort((a, b) => a.pct! - b.pct! || a.date.localeCompare(b.date));
  const worstDay = ranked[0] ?? null, bestDay = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  // Axes : régularité et indemnités ; meilleur et pire parmi les axes d'au moins 30 trains.
  const costByAxis = new Map<string, number>();
  for (const g of s.groups) costByAxis.set(g.axis, (costByAxis.get(g.axis) ?? 0) + g.estimated_cost_eur_ht);
  const axes = axisRegularity(s.groups).map((a) => ({ ...a, cost: costByAxis.get(a.axis) ?? 0 })).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  const solid = axes.filter((a) => !a.small && a.pct !== null);
  const bestAxis = solid[0]?.axis ?? null, worstAxis = solid.length > 1 ? solid[solid.length - 1].axis : null;

  // Causes : les 3 premières en euros, avec leur rang en nombre de trains pour la phrase.
  const causeTotal = s.cause_breakdown.reduce((a, c) => a + c.cost_eur_ht, 0);
  const byTrains = [...s.cause_breakdown].sort((a, b) => b.trains - a.trains || a.category.localeCompare(b.category)).map((c) => c.category);
  const causes = s.cause_breakdown.slice(0, 3).map((c, i) => {
    const share = causeTotal === 0 ? 0 : Math.round((c.cost_eur_ht / causeTotal) * 100);
    const trainRank = byTrains.indexOf(c.category) + 1;
    const rank = i === 0 ? 'première' : i === 1 ? 'deuxième' : 'troisième';
    const sentence = trainRank > i + 1
      ? `${causeLong(c.category)} : ${nf(c.trains)} trains seulement (${trainRank}e en nombre), mais ${rank} cause en euros avec ${c.avg_delay_min}′ de retard moyen.`
      : `${causeLong(c.category)} : ${nf(c.trains)} trains, ${c.avg_delay_min}′ de retard moyen, ${share} % des indemnités liées à une cause.`;
    return { ...c, label: causeShort(c.category), share, sentence };
  });

  // Heatmap : heures présentes dans la semaine ; une case sous 5 trains est estompée.
  const cells = p.heatmap ?? [];
  const hours = cells.length ? Array.from({ length: Math.max(...cells.map((c) => c[1])) - Math.min(...cells.map((c) => c[1])) + 1 }, (_, i) => Math.min(...cells.map((c) => c[1])) + i) : [];
  const heat = DOW.map((label, i) => ({ label, cells: hours.map((h) => {
    const c = cells.find((x) => x[0] === i + 1 && x[1] === h);
    return c ? { hour: h, n: c[2], avg_min: Math.round(c[3] / 60), avg_s: c[3] } : { hour: h, n: 0, avg_min: null, avg_s: null };
  }) }));

  const brands = brandSplit(s.groups);
  const train = p.train && {
    ...p.train, delay_sum_min: Math.round(p.train.delay_sum_s / 60),
    days: p.train.days.map(([date, observed, cancelled, delay_s]) => ({
      date, label: dayLabel(date), state: !observed ? 'unobserved' as const : cancelled ? 'cancelled' as const : 'ran' as const, delay_s,
    })),
  };

  const prevIncomplete = prev !== null && prev.payload.days < 7;
  const vs = prev ? ` par rapport à la semaine ${weekNum(prev.week)}${prevIncomplete ? ` (incomplète, ${prev.payload.days} jours)` : ''}` : '';
  const takeaways: string[] = [];
  const dr = kpis.regularity.delta;
  if (dr && dr.value !== 0) takeaways.push(`La régularité ${dr.value > 0 ? 'gagne' : 'perd'} ${fr1(Math.abs(dr.value))} point${Math.abs(dr.value) >= 2 ? 's' : ''}${vs}, à ${fr1(t.official_regularity_pct!)} %.`);
  if (worstAxis && bestAxis) {
    const w = axes.find((a) => a.axis === worstAxis)!, b = axes.find((a) => a.axis === bestAxis)!;
    takeaways.push(`${axisName(worstAxis)} est l’axe le moins régulier (${fr1(w.pct!)} %), ${fr1(b.pct! - w.pct!)} points derrière ${axisName(bestAxis)} (${fr1(b.pct!)} %).`);
  }
  if (worstDay) takeaways.push(`Pire jour : ${worstDay.label.toLowerCase()} avec ${fr1(worstDay.pct!)} % de trains à l’heure${worstDay.cause ? `, cause la plus citée : ${causeShort(worstDay.cause).toLowerCase()}` : ''}.`);
  if (causes[0]) takeaways.push(`${causes[0].label.charAt(0) + causes[0].label.slice(1).toLowerCase()} pèse ${causes[0].share} % des indemnités liées à une cause.`);
  const bon = kpis.cost.bon;
  const bonShare = bon === null || t.estimated_cost_eur_ht === 0 ? null : Math.round((bon / t.estimated_cost_eur_ht) * 100);
  if (bonShare !== null && bonShare > BON_SHARE_KEY) takeaways.push(`${bonShare} % des indemnités théoriques (${nf(Math.round(bon!))} €) sont dues en bons d’achat, et non en argent.`);
  if (train) takeaways.push(`Le ${train.number} ${train.origin ?? '?'} → ${train.dest ?? '?'} n’a été à l’heure ${train.ok === 0 ? 'aucun jour' : `que ${train.ok} jour${train.ok > 1 ? 's' : ''}`} sur ${train.counted}.`);

  return {
    week: row.week, num: weekNum(row.week), from: p.from, to: p.to, days: p.days, complete: p.days === 7, computed_at: row.computed_at,
    title: `SEMAINE ${weekNum(row.week)} · DU ${ddmm(p.from)} AU ${ddmm(p.to)}`,
    prev: prev && { week: prev.week, num: weekNum(prev.week), incomplete: prevIncomplete, days: prev.payload.days },
    counts, kpis, train, byDay: days, worstDay, bestDay, axes, bestAxis, worstAxis, causes, heat, brands, takeaways: takeaways.slice(0, 6),
    // Bilan figé avant le plafond international : écart estimé, les totaux restent ceux publiés.
    intlCapNote: t.estimated_cost_eur_ht_bon === null && extra?.intl_cap != null ? { from: INTL_CAP_FROM, eur: extra.intl_cap } : null,
    small: isSmallSample(t), occupancy: s.assumptions.occupancy,
  };
}

export type WeekView = ReturnType<typeof shapeWeek>;

// Résumé à coller sur un réseau social : 5 lignes au plus, chiffres de la page et lien.
export function summaryText(v: WeekView, url: string): string {
  const k = v.kpis, d = k.regularity.delta;
  const vs = d && v.prev ? ` (${d.value > 0 ? '+' : d.value < 0 ? '−' : '±'}${fr1(Math.abs(d.value))} pt vs S${v.prev.num}${v.prev.incomplete ? ', incomplète' : ''})` : '';
  const cost = k.cost.value >= 1e6 ? `${fr1(k.cost.value / 1e6)} M€` : `${nf(Math.round(k.cost.value / 1000))} k€`;
  return [
    `TGV · semaine ${v.num} (${ddmm(v.from)} → ${ddmm(v.to)})${v.complete ? '' : `, ${v.days} jours`}`,
    `Régularité : ${k.regularity.value === null ? '—' : `${fr1(k.regularity.value)} %`}${vs}`,
    `Indemnités théoriques : ${cost} HT · ${nf(k.trains.value)} trains`,
    ...(v.train ? [`Train de la semaine : ${v.train.number} ${v.train.origin ?? '?'} → ${v.train.dest ?? '?'}, à l’heure ${v.train.ok}/${v.train.counted} jours`] : []),
    url,
  ].join('\n');
}
export const axisName = (a: string) => a.replace('_', '-');
