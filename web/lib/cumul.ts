import { round, toNum } from './num';
import { DEFAULT_OCCUPANCY, type Price, type StatRow, type Totals } from './stats';

export type CumulRow = { brand: string; metric: string; n: number | string; days: number; first_day: string; last_day: string };
export type CumulBrand = {
  brand: string; planned: number; observed: number; circulated: number; cancelled: number; no_terminus: number; comp_eligible: number; comp_pct_sum: number;
  aberrant: number; comp_pct_sum_low: number; comp_pct_sum_high: number; comp_pct_sum_bon: number;
  cost_eur_ht: number; cost_eur_ht_at_full_occupancy: number;
  cost_eur_ht_bon: number | null; // part en bons d'achat ; null avant que daily_stats ait la mesure
  // Fourchette ; null quand des jours enregistrés n'ont pas encore les mesures basse et haute.
  cost_eur_ht_low: number | null; cost_eur_ht_high: number | null;
};
export type Cumul = {
  since: string | null; through: string | null; days: number;
  planned: number; observed: number; coverage_pct: number | null; circulated: number; cancelled: number; no_terminus: number;
  comp_eligible: number; aberrant: number;
  cost_eur_ht: number; cost_eur_ht_at_full_occupancy: number;
  cost_eur_ht_low: number | null; cost_eur_ht_high: number | null;
  cost_eur_ht_bon: number | null;
  by_brand: CumulBrand[];
  assumptions: { occupancy: number; prices: Price[] };
};

// Réponse de /api/cumul : le jour en cours à part (ligne AUJOURD'HUI) et l'heure du calcul.
export type CumulPayload = Cumul & { today: Totals; computed_at: string };

const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

// Ajoute aux jours enregistrés (daily_stats, réécrits chaque nuit) les jours from..to calculés à la volée,
// dont le jour en cours : seuls les trains déjà terminés y figurent.
export function withLive(base: CumulRow[], live: StatRow[], from: string, to: string): CumulRow[] {
  if (live.length === 0 || from > to) return base;
  const days = (base[0]?.days ?? 0) + (Date.parse(to) - Date.parse(from)) / DAY_MS + 1;
  const first_day = base[0]?.first_day ?? from;
  return [...base, ...live].map((r) => ({ brand: r.brand, metric: r.metric, n: r.n, days, first_day, last_day: to }));
}

const COUNTS = ['planned', 'observed', 'circulated', 'cancelled', 'no_terminus', 'comp_eligible', 'comp_pct_sum', 'aberrant', 'comp_pct_sum_low', 'comp_pct_sum_high', 'comp_pct_sum_bon'] as const;

// Compteur observé seulement : jamais extrapolé aux trains non observés. Le coût se calcule à la lecture
// (prix, places et occupation sont des hypothèses) : pourcentage cumulé × prix HT × places × occupation.
export function shapeCumul(rows: CumulRow[], prices: Price[], occupancy = DEFAULT_OCCUPANCY): Cumul {
  const refs = prices.map((p) => ({ ...p, price_eur_ht: toNum(p.price_eur_ht, 'price_eur_ht'), seats: toNum(p.seats, 'seats') }))
    .sort((a, b) => a.brand.localeCompare(b.brand));
  const hasRange = rows.some((r) => r.metric === 'comp_pct_sum_high');
  const hasBon = rows.some((r) => r.metric === 'comp_pct_sum_bon');
  const byBrand = new Map<string, Record<(typeof COUNTS)[number], number>>();
  for (const r of rows) {
    if (!(COUNTS as readonly string[]).includes(r.metric)) continue; // tranches de retard : sans objet ici
    const c = byBrand.get(r.brand) ?? { planned: 0, observed: 0, circulated: 0, cancelled: 0, no_terminus: 0, comp_eligible: 0, comp_pct_sum: 0, aberrant: 0, comp_pct_sum_low: 0, comp_pct_sum_high: 0, comp_pct_sum_bon: 0 };
    c[r.metric as (typeof COUNTS)[number]] += toNum(r.n, r.metric);
    byBrand.set(r.brand, c);
  }
  const brands = [...byBrand.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([brand, c]) => {
    const price = refs.find((p) => p.brand === brand);
    if (!price) throw new Error(`prix de référence absent pour ${brand}`);
    const full = (c.comp_pct_sum / 100) * price.price_eur_ht * price.seats;
    const perPct = (price.price_eur_ht * price.seats * occupancy) / 100;
    return { brand, ...c, full, cost: full * occupancy, low: hasRange ? c.comp_pct_sum_low * perPct : null, high: hasRange ? c.comp_pct_sum_high * perPct : null,
      bon: hasBon ? c.comp_pct_sum_bon * perPct : null };
  });
  const sum = (f: (b: (typeof brands)[number]) => number) => brands.reduce((s, b) => s + f(b), 0);
  const planned = sum((b) => b.planned), observed = sum((b) => b.observed);
  const sumOrNull = (f: (b: (typeof brands)[number]) => number | null) => (hasRange ? round(sum((b) => f(b) ?? 0), 2) : null);
  return {
    since: rows[0]?.first_day ?? null,
    through: rows[0]?.last_day ?? null,
    days: rows[0]?.days ?? 0,
    planned, observed,
    coverage_pct: planned === 0 ? null : round((observed / planned) * 100, 1),
    circulated: sum((b) => b.circulated),
    cancelled: sum((b) => b.cancelled),
    no_terminus: sum((b) => b.no_terminus),
    comp_eligible: sum((b) => b.comp_eligible),
    aberrant: sum((b) => b.aberrant),
    cost_eur_ht_low: sumOrNull((b) => b.low),
    cost_eur_ht_high: sumOrNull((b) => b.high),
    cost_eur_ht_bon: hasBon ? round(sum((b) => b.bon ?? 0), 2) : null,
    cost_eur_ht: round(sum((b) => b.cost), 2),
    cost_eur_ht_at_full_occupancy: round(sum((b) => b.full), 2),
    by_brand: brands.map(({ full, cost, low, high, bon, ...b }) => ({
      ...b, cost_eur_ht: round(cost, 2), cost_eur_ht_at_full_occupancy: round(full, 2), cost_eur_ht_bon: bon === null ? null : round(bon, 2),
      cost_eur_ht_low: low === null ? null : round(low, 2), cost_eur_ht_high: high === null ? null : round(high, 2),
    })),
    assumptions: { occupancy, prices: refs },
  };
}
