import { CAUSE_LABELS } from './causes';
import type { Counts } from './counts';
import { isSmallSample, suppressionPct } from './dashboard-model';
import { stationName } from './station';
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
const DOW_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dayLabel = (d: string) => `${DOW[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]} ${ddmm(d)}`;
const pct1 = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 1000) / 10);
const fr1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf = (n: number) => n.toLocaleString('fr-FR');
const ordinal = (n: number) => (n === 1 ? '1re' : `${n}e`); // « cause » : féminin
// 1,3 M€ ou 58 k€ ; `digits` décimales au-delà du million.
const eur = (n: number, digits = 1) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} M€` : `${nf(Math.round(n / 1000))} k€`);
const causeShort = (c: string) => CAUSE_LABELS[c]?.short ?? c.toUpperCase();
const causeLong = (c: string) => CAUSE_LABELS[c]?.long ?? c;

// Semaine ISO complète la plus récente à l'heure de Paris, décalée de 7 h : le bilan du lundi n'existe qu'après la tâche
// de 05:00 UTC (06:00 l'hiver, 07:00 l'été).
export function lastCompleteWeekId(now: Date): string {
  const d = new Date(now.getTime() - 7 * 3600_000 - 7 * 86_400_000);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // jeudi de la semaine ISO
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const n = 1 + Math.round(((t.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(n).padStart(2, '0')}`;
}
export const lastCompleteWeek = (now: Date): number => weekNum(lastCompleteWeekId(now));
// Lundi et dimanche (JJ/MM) d'une semaine ISO « 2026-W44 ».
export function weekDays(id: string): [string, string] {
  const jan4 = new Date(Date.UTC(Number(id.slice(0, 4)), 0, 4));
  const monday = new Date(jan4.getTime() + (((weekNum(id) - 1) * 7) - ((jan4.getUTCDay() + 6) % 7)) * 86_400_000);
  const f = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return [f(monday), f(new Date(monday.getTime() + 6 * 86_400_000))];
}

type Delta = { value: number; unit: '%' | 'PT'; good: boolean } | null;
// Variation : en % pour un volume, en points pour un taux ; « good » colore la flèche (une hausse de régularité est bonne).
const deltaPct = (cur: number, prev: number | undefined, higherIsGood: boolean): Delta =>
  prev === undefined || prev === 0 ? null : { value: Math.round(((cur - prev) / prev) * 1000) / 10, unit: '%', good: (cur >= prev) === higherIsGood };
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
  // Variations seulement entre deux semaines complètes : une semaine incomplète (S43, début de collecte) fausse la comparaison.
  const pt = prev && prev.payload.days === 7 && p.days === 7 ? totalsOf(prev.payload).totals : null;
  const supp = suppressionPct(t);
  const counts: Counts = { observed: t.observed, circulated: t.circulated, cancelled: t.cancelled, no_terminus: t.no_terminus, aberrant: t.aberrant };

  const kpis = {
    // Nombre de trains sans variation : il suit surtout la couverture de la collecte, pas le trafic.
    trains: { value: t.circulated },
    regularity: { value: t.official_regularity_pct, delta: deltaPt(t.official_regularity_pct, pt?.official_regularity_pct, true) },
    cost: { value: t.estimated_cost_eur_ht, low: t.estimated_cost_eur_ht_low, high: t.estimated_cost_eur_ht_high, delta: deltaPct(t.estimated_cost_eur_ht, pt?.estimated_cost_eur_ht, false),
      bon: t.estimated_cost_eur_ht_bon ?? extra?.bon ?? null },
    suppressions: { value: supp, n: t.cancelled, delta: deltaPt(supp, pt ? suppressionPct(pt) : undefined, false) },
  };

  // Jours : régularité et cause la plus citée (hors « sans cause ») ; meilleur parmi les jours d'au moins 30 trains.
  const days = p.by_day.map(({ date, m }) => {
    const get = (k: string) => Number(m?.[k] ?? 0);
    const causes = Object.keys(m ?? {}).filter((k) => k.startsWith('cause:') && k !== 'cause:sans_cause')
      .sort((a, b) => get(b) - get(a) || a.localeCompare(b));
    return { date, label: dayLabel(date), circulated: get('circulated'), pct: pct1(get('on_time_official'), get('circulated')), cause: causes[0]?.slice(6) ?? null };
  });
  const ranked = days.filter((d) => d.pct !== null && !isSmallSample(d)).sort((a, b) => a.pct! - b.pct! || a.date.localeCompare(b.date));
  const bestDay = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  // Axes : régularité, indemnités et indemnité moyenne par train ; meilleur et pire parmi les axes d'au moins 30 trains.
  const axes = axisRegularity(s.groups).map((a) => ({ ...a, per_train: a.circulated === 0 ? null : Math.round(a.cost / a.circulated) }))
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  const solid = axes.filter((a) => !a.small && a.pct !== null);
  const bestAxis = solid[0]?.axis ?? null, worstAxis = solid.length > 1 ? solid[solid.length - 1].axis : null;

  // Causes : les 3 premières en euros, avec leur rang en nombre de trains pour la phrase.
  const causeTotal = s.cause_breakdown.reduce((a, c) => a + c.cost_eur_ht, 0);
  const byTrains = [...s.cause_breakdown].sort((a, b) => b.trains - a.trains || a.category.localeCompare(b.category)).map((c) => c.category);
  // Phrase selon l'écart des deux rangs : « seulement » si la cause est au moins 2 rangs plus bas en nombre qu'en euros.
  const causes = s.cause_breakdown.slice(0, 3).map((c, i) => {
    const share = causeTotal === 0 ? 0 : Math.round((c.cost_eur_ht / causeTotal) * 100);
    const euroRank = i + 1, trainRank = byTrains.indexOf(c.category) + 1;
    const rank = i === 0 ? 'première' : i === 1 ? 'deuxième' : 'troisième';
    const trains = `${nf(c.trains)} train${c.trains > 1 ? 's' : ''}`;
    const sentence = trainRank - euroRank >= 2
      ? `${causeLong(c.category)} : ${trains} seulement (${ordinal(trainRank)} en nombre), mais ${rank} cause en euros avec ${c.avg_delay_min}′ de retard moyen.`
      : euroRank - trainRank >= 2
        ? `${causeLong(c.category)} : ${trains} (${ordinal(trainRank)} en nombre), mais des retards plus courts, ${c.avg_delay_min}′ en moyenne.`
        : `${causeLong(c.category)} : ${trains}, ${c.avg_delay_min}′ de retard moyen, ${share} % des indemnités liées à une cause.`;
    return { ...c, label: causeShort(c.category), share, euroRank, trainRank, sentence };
  });

  // Heatmap : heures présentes dans la semaine, sans les heures de nuit (1 h à 6 h) restées vides ; une case sous 5 trains est estompée.
  const cells = p.heatmap ?? [];
  const lo = Math.min(...cells.map((c) => c[1])), hi = Math.max(...cells.map((c) => c[1]));
  const hours = cells.length ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((h) => h < 1 || h > 6 || cells.some((c) => c[1] === h)) : [];
  const heat = DOW.map((label, i) => ({ label, cells: hours.map((h) => {
    const c = cells.find((x) => x[0] === i + 1 && x[1] === h);
    return c ? { hour: h, n: c[2], avg_min: Math.round(c[3] / 60), avg_s: c[3] } : { hour: h, n: 0, avg_min: null, avg_s: null };
  }) }));
  // Créneau le plus touché : case de la grille au plus fort retard moyen, parmi celles d'au moins 5 trains (cases non estompées).
  const top = cells.filter((c) => c[2] >= 5).sort((a, b) => b[3] - a[3] || b[2] - a[2] || a[0] - b[0] || a[1] - b[1])[0];
  const worstSlot = top ? { dow: top[0], hour: top[1], n: top[2], avg_min: Math.round(top[3] / 60),
    label: days.find((d) => d.label.startsWith(DOW[top[0] - 1]))?.label ?? DOW[top[0] - 1] } : null;

  const brands = brandSplit(s.groups);
  const train = p.train && {
    ...p.train, delay_sum_min: Math.round(p.train.delay_sum_s / 60),
    origin: p.train.origin && stationName(p.train.origin), dest: p.train.dest && stationName(p.train.dest),
    days: p.train.days.map(([date, observed, cancelled, delay_s]) => ({
      date, label: dayLabel(date), state: !observed ? 'unobserved' as const : cancelled ? 'cancelled' as const : 'ran' as const, delay_s,
    })),
  };

  const prevIncomplete = prev !== null && prev.payload.days < 7;
  const vs = prev ? ` par rapport à la semaine ${weekNum(prev.week)}` : '';
  const takeaways: string[] = [];
  const dr = kpis.regularity.delta;
  if (dr && dr.value !== 0) takeaways.push(`La régularité ${dr.value > 0 ? 'gagne' : 'perd'} ${fr1(Math.abs(dr.value))} point${Math.abs(dr.value) >= 2 ? 's' : ''}${vs}, à ${fr1(t.official_regularity_pct!)} %.`);
  if (worstAxis && bestAxis) {
    const w = axes.find((a) => a.axis === worstAxis)!, b = axes.find((a) => a.axis === bestAxis)!;
    takeaways.push(`${axisName(worstAxis)} est l’axe le moins régulier (${fr1(w.pct!)} %), ${fr1(b.pct! - w.pct!)} points derrière ${axisName(bestAxis)} (${fr1(b.pct!)} %).`);
  }
  if (worstSlot) takeaways.push(`Créneau le plus touché : ${DOW_LONG[worstSlot.dow - 1]} ${worstSlot.hour} h, ${worstSlot.avg_min}′ de retard moyen sur ${worstSlot.n} trains arrivés.`);
  if (causes[0]) takeaways.push(`${causes[0].label.charAt(0) + causes[0].label.slice(1).toLowerCase()} pèse ${causes[0].share} % des indemnités liées à une cause.`);
  const bon = kpis.cost.bon;
  const bonShare = bon === null || t.estimated_cost_eur_ht === 0 ? null : Math.round((bon / t.estimated_cost_eur_ht) * 100);
  if (bonShare !== null && bonShare > BON_SHARE_KEY) takeaways.push(`${eur(bon!, 2)} sur ${eur(t.estimated_cost_eur_ht)} d’indemnités théoriques (${bonShare} %) sont dus en bons d’achat, et non en argent.`);
  if (train) takeaways.push(`Le ${train.number} ${train.origin ?? '?'} → ${train.dest ?? '?'} n’a été à l’heure ${train.ok === 0 ? 'aucun jour' : `que ${train.ok} jour${train.ok > 1 ? 's' : ''}`} sur ${train.counted}.`);

  return {
    week: row.week, num: weekNum(row.week), from: p.from, to: p.to, days: p.days, complete: p.days === 7, computed_at: row.computed_at,
    title: `SEMAINE ${weekNum(row.week)} · DU ${ddmm(p.from)} AU ${ddmm(p.to)}`,
    prev: prev && { week: prev.week, num: weekNum(prev.week), incomplete: prevIncomplete, days: prev.payload.days },
    counts, kpis, train, byDay: days, worstSlot, bestDay, axes, bestAxis, worstAxis, causes, heat, brands, takeaways: takeaways.slice(0, 6),
    // Bilan figé avant le plafond international : écart estimé, les totaux restent ceux publiés.
    intlCapNote: t.estimated_cost_eur_ht_bon === null && extra?.intl_cap != null ? { from: INTL_CAP_FROM, eur: extra.intl_cap } : null,
    small: isSmallSample(t), occupancy: s.assumptions.occupancy,
  };
}

export type WeekView = ReturnType<typeof shapeWeek>;

// Résumé à coller sur un réseau social : 5 lignes au plus, chiffres de la page et lien.
export function summaryText(v: WeekView, url: string): string {
  const k = v.kpis, d = k.regularity.delta;
  const vs = d && v.prev ? ` (${d.value > 0 ? '+' : d.value < 0 ? '−' : '±'}${fr1(Math.abs(d.value))} pt vs S${v.prev.num})` : '';
  const cost = eur(k.cost.value);
  return [
    `TGV · semaine ${v.num} (${ddmm(v.from)} → ${ddmm(v.to)})${v.complete ? '' : `, ${v.days} jours`}`,
    `Régularité : ${k.regularity.value === null ? '—' : `${fr1(k.regularity.value)} %`}${vs}`,
    `Indemnités théoriques : ${cost} HT · ${nf(k.trains.value)} trains`,
    ...(v.train ? [`Train de la semaine : ${v.train.number} ${v.train.origin ?? '?'} → ${v.train.dest ?? '?'}, à l’heure ${v.train.ok}/${v.train.counted} jours`] : []),
    url,
  ].join('\n');
}
export const axisName = (a: string) => a.replace('_', '-');
