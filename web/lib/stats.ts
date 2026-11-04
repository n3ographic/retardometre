import { round, toNum } from './num';

export type StatRow = { brand: string; axis: string; metric: string; n: number };
export type Price = { brand: string; price_eur_ht: number; seats: number; price_source: string; seats_source: string; as_of: string };
// scope et form absents des bilans figés avant le 04/11/2026 : barème national, forme inconnue.
export type Scale = {
  brand: string; from_s: number; pct: number; source_url: string; source_as_of: string;
  scope?: 'national' | 'international'; form?: 'bon' | 'argent';
};
export const SCALE_COLUMNS = 'brand,scope,from_s,pct,form,source_url,source_as_of';

// Paliers d'une marque pour un train : barème international de la marque s'il existe, sinon national (comme en base).
export function scaleFor(scale: Scale[], brand: string, intl = false): Scale[] {
  const of = (scope: string) => scale.filter((s) => s.brand === brand && (s.scope ?? 'national') === scope);
  const own = intl ? of('international') : [];
  return (own.length ? own : of('national')).sort((a, b) => a.from_s - b.from_s);
}

// Occupation de référence (ART 2023 : 76-77 % tous TGV, pas par marque). Le coût est linéaire :
// coût = cost_eur_ht_at_full_occupancy × occupation.
export const DEFAULT_OCCUPANCY = 0.75;

// Fourchette des indemnités : le retard publié va par pas de 5 min, le retard réel est à moins de 4 min 59 s près ;
// un retard d'au moins 12 h est écarté des mesures. Mêmes valeurs que aberrant_delay_s() et delay_tolerance_s() en base.
export const RANGE = { delay_tolerance_s: 299, aberrant_delay_s: 43200 };

const COUNTS = ['planned', 'observed', 'removed_late', 'never_observed', 'cancelled', 'no_terminus',
  'circulated', 'on_time_official', 'comp_eligible', 'comp_pct_sum', 'aberrant', 'skipped_stop',
  'comp_pct_sum_low', 'comp_pct_sum_high'] as const;
// Retards publiés par pas de 5 min : la tranche 1-4 de la base (quasi vide, ~0,1 %) est fondue avec 0 en « 0-4 ».
const BUCKETS = ['0-4', '5-14', '15-29', '30-59', '60-119', '120-179', '180+'];
const MERGED: Record<string, string> = { '0': '0-4', '1-4': '0-4' };
const STOP_BUCKETS = [...BUCKETS, 'cancelled'];

type Counts = Record<(typeof COUNTS)[number], number>;
export type Totals = Counts & {
  official_regularity_pct: number | null;
  terminus_buckets: Record<string, number>;
  stop_buckets: Record<string, number>;
  estimated_cost_eur_ht: number;
  cost_eur_ht_at_full_occupancy: number;
  // Fourchette ; null quand les lignes reçues n'ont pas les mesures basse et haute (ancienne réponse en cache).
  estimated_cost_eur_ht_low: number | null;
  estimated_cost_eur_ht_high: number | null;
};
export type Group = { brand: string; axis: string } & Totals;
// Retards d'au moins 5 min par catégorie de cause déclarée (codes de cause_rules, voir lib/causes.ts).
export type CauseRow = { category: string; trains: number; avg_delay_min: number; cost_eur_ht: number };
export type StatsPayload = {
  from: string; to: string; groups: Group[]; totals: Totals; cause_breakdown: CauseRow[];
  computed_at?: string; // posé par le handler, dans l'unité mise en cache
  assumptions: { occupancy: number; prices: Price[]; compensation_scale: Scale[]; range: typeof RANGE };
};

const zeros = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, 0]));
const empty = (): Totals => ({
  ...(zeros(COUNTS) as Counts), official_regularity_pct: null,
  terminus_buckets: zeros(BUCKETS), stop_buckets: zeros(STOP_BUCKETS), estimated_cost_eur_ht: 0, cost_eur_ht_at_full_occupancy: 0,
  estimated_cost_eur_ht_low: null, estimated_cost_eur_ht_high: null,
});
const regularity = (t: Totals) => (t.circulated === 0 ? null : round((t.on_time_official / t.circulated) * 100, 1));

export function shapeStats(rows: StatRow[], rawPrices: Price[], rawScale: Scale[], p: { from: string; to: string }): StatsPayload {
  const prices = rawPrices
    .map((x) => ({ ...x, price_eur_ht: toNum(x.price_eur_ht, 'price_eur_ht'), seats: toNum(x.seats, 'seats') }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
  const scale = rawScale
    .map((x) => ({ ...x, from_s: toNum(x.from_s, 'from_s'), pct: toNum(x.pct, 'pct') }))
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.from_s - b.from_s);
  const groups = new Map<string, Group>();
  const causes = new Map<string, { trains: number; delay_s: number; cost: number }>();
  const priceOf = (brand: string) => {
    const price = prices.find((x) => x.brand === brand);
    if (!price) throw new Error(`prix de référence absent pour ${brand}`);
    return price;
  };
  for (const row of rows) {
    const n = toNum(row.n, row.metric);
    const key = `${row.brand}|${row.axis}`;
    const g = groups.get(key) ?? { brand: row.brand, axis: row.axis, ...empty() };
    groups.set(key, g);
    const [kind, bucket] = row.metric.split(':');
    if (bucket !== undefined && kind.startsWith('cause')) {
      const c = causes.get(bucket) ?? { trains: 0, delay_s: 0, cost: 0 };
      causes.set(bucket, c);
      if (kind === 'cause') c.trains += n;
      else if (kind === 'cause_delay_s') c.delay_s += n;
      else if (kind === 'cause_comp') { const pr = priceOf(row.brand); c.cost += (n / 100) * pr.price_eur_ht * pr.seats * DEFAULT_OCCUPANCY; }
    } else if (bucket !== undefined) {
      const target = kind === 'terminus' ? g.terminus_buckets : kind === 'stop' ? g.stop_buckets : undefined;
      const b = MERGED[bucket] ?? bucket;
      if (target && b in target) target[b] += n;
    } else if ((COUNTS as readonly string[]).includes(row.metric)) {
      g[row.metric as keyof Counts] += n;
    } // métrique inconnue : ignorée
  }

  const hasRange = rows.some((x) => x.metric === 'comp_pct_sum_high');
  const totals = empty();
  let cost = 0, low = 0, high = 0;
  const list = [...groups.values()].sort((a, b) => a.brand.localeCompare(b.brand) || a.axis.localeCompare(b.axis));
  for (const g of list) {
    const price = prices.find((x) => x.brand === g.brand);
    if (!price) throw new Error(`prix de référence absent pour ${g.brand}`);
    const full = (g.comp_pct_sum / 100) * price.price_eur_ht * price.seats;
    cost += full;
    g.cost_eur_ht_at_full_occupancy = round(full, 2);
    g.estimated_cost_eur_ht = round(full * DEFAULT_OCCUPANCY, 2);
    const perPct = (price.price_eur_ht * price.seats * DEFAULT_OCCUPANCY) / 100;
    if (hasRange) {
      g.estimated_cost_eur_ht_low = round(g.comp_pct_sum_low * perPct, 2);
      g.estimated_cost_eur_ht_high = round(g.comp_pct_sum_high * perPct, 2);
      low += g.comp_pct_sum_low * perPct;
      high += g.comp_pct_sum_high * perPct;
    }
    g.official_regularity_pct = regularity(g);
    for (const k of COUNTS) totals[k] += g[k];
    for (const k of BUCKETS) totals.terminus_buckets[k] += g.terminus_buckets[k];
    for (const k of STOP_BUCKETS) totals.stop_buckets[k] += g.stop_buckets[k];
  }
  totals.cost_eur_ht_at_full_occupancy = round(cost, 2);
  totals.estimated_cost_eur_ht = round(cost * DEFAULT_OCCUPANCY, 2);
  if (hasRange) {
    totals.estimated_cost_eur_ht_low = round(low, 2);
    totals.estimated_cost_eur_ht_high = round(high, 2);
  }
  totals.official_regularity_pct = regularity(totals);

  const cause_breakdown = [...causes.entries()]
    .filter(([, c]) => c.trains > 0)
    .map(([category, c]) => ({ category, trains: c.trains, avg_delay_min: Math.round(c.delay_s / c.trains / 60), cost_eur_ht: round(c.cost, 2) }))
    .sort((a, b) => b.cost_eur_ht - a.cost_eur_ht || b.trains - a.trains || a.category.localeCompare(b.category));

  return {
    from: p.from, to: p.to, groups: list, totals, cause_breakdown,
    assumptions: {
      occupancy: DEFAULT_OCCUPANCY, prices, compensation_scale: scale, range: RANGE,
    },
  };
}
