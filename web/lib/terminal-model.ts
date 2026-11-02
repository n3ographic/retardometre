import { SAMPLE_MIN, TERMINUS_BUCKETS, isSmallSample } from './dashboard-model';
import { mareyHref } from './marey';
import type { LiveItem } from './map-model';
import type { Group } from './stats';

export type Tone = 'ontime' | 'late' | 'strong' | 'severe' | 'cancelled';

const FRESH_S = 600;

// Quatre tons d'affichage (les classes de la carte, delayClass, gardent leurs propres seuils).
export function delayTone(delay_s: number | undefined, cancelled: boolean): Tone {
  if (cancelled) return 'cancelled';
  const d = delay_s ?? 0;
  return d >= 3600 ? 'severe' : d >= 1800 ? 'strong' : d >= 300 ? 'late' : 'ontime';
}

export function topDelays(trains: LiveItem[], n: number): LiveItem[] {
  return trains
    .filter((t) => !t.cancelled && (t.delay_s ?? 0) > 0)
    .sort((a, b) => (b.delay_s ?? 0) - (a.delay_s ?? 0) || a.train_number.localeCompare(b.train_number))
    .slice(0, n);
}

export function tickerItems(trains: LiveItem[], n: number): { trip_id: string; label: string; minutes: number; tone: Tone; href: string | null }[] {
  return topDelays(trains, n).map((t) => ({
    trip_id: t.trip_id,
    label: [`${t.brand} ${t.train_number}`, [t.origin, t.dest].filter(Boolean).join(' → ')].filter(Boolean).join(' '),
    minutes: Math.round((t.delay_s ?? 0) / 60),
    tone: delayTone(t.delay_s, t.cancelled),
    href: mareyHref(t),
  }));
}

// Fraîcheur de la collecte : âge du passage le plus récent du collecteur.
export function collectStatus(trains: LiveItem[], now: Date): { status: 'ok' | 'late' | 'unknown'; ageMin: number | null } {
  const seen = trains.map((t) => (t.last_seen_at ? Date.parse(t.last_seen_at) : NaN)).filter(Number.isFinite);
  if (seen.length === 0) return { status: 'unknown', ageMin: null };
  const ageS = (now.getTime() - Math.max(...seen)) / 1000;
  return { status: ageS < FRESH_S ? 'ok' : 'late', ageMin: Math.round(ageS / 60) };
}

// Régularité par axe, toutes marques confondues.
export function axisRegularity(groups: Group[]): { axis: string; circulated: number; on_time: number; pct: number | null; small: boolean }[] {
  const by = new Map<string, { circulated: number; on_time: number }>();
  for (const g of groups) {
    const a = by.get(g.axis) ?? { circulated: 0, on_time: 0 };
    a.circulated += g.circulated;
    a.on_time += g.on_time_official;
    by.set(g.axis, a);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([axis, a]) => ({
    axis, ...a,
    pct: a.circulated === 0 ? null : Math.round((a.on_time / a.circulated) * 1000) / 10,
    small: a.circulated < SAMPLE_MIN,
  }));
}

// Barre de caractères : cellules pleines, plus une demi-cellule à partir de la moitié.
export function charBar(pct: number | null, width: number): string {
  if (!pct || pct <= 0) return '';
  const cells = (Math.min(pct, 100) / 100) * width;
  const full = Math.floor(cells);
  return '█'.repeat(full) + (cells - full >= 0.5 ? '▌' : '');
}

// Période des statistiques : '7d', '14d', '31d' ou un mois 'AAAA-MM'.
export type Period = string;
export const FIXED_PERIODS = ['7d', '14d', '31d'] as const;
const MONTHS = ['JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN', 'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.'];

export function periodQuery(p: Period): string {
  return /^\d+d$/.test(p) ? `period=${p}` : `month=${p}`;
}

export function periodLabel(p: Period): string {
  if (/^\d+d$/.test(p)) return `${p.slice(0, -1)}J`;
  const [y, m] = p.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// Barre de tranches en caractères : `width` cases réparties par plus forts restes ; une tranche trop petite peut disparaître.
export function bucketBar(buckets: Record<string, number>, width: number): { i: number; bucket: string; len: number }[] {
  const ns = TERMINUS_BUCKETS.map((b) => buckets[b] ?? 0);
  const total = ns.reduce((a, n) => a + n, 0);
  if (total === 0) return [];
  const exact = ns.map((n) => (n / total) * width);
  const lens = exact.map(Math.floor);
  const order = exact.map((x, i) => i).sort((a, b) => (exact[b] - lens[b]) - (exact[a] - lens[a]) || a - b);
  for (let k = width - lens.reduce((a, n) => a + n, 0), j = 0; k > 0; k--, j++) lens[order[j]]++;
  return TERMINUS_BUCKETS.map((bucket, i) => ({ i, bucket, len: lens[i] })).filter((s) => s.len > 0);
}

// Ce que veulent dire les bornes de la fourchette (infobulle).
export const RANGE_HINT = 'Bas : retard publié − 4 min 59 s, sans les trains qui sautent un arrêt. Haut : retard publié + 4 min 59 s. Occupation de 0,75 dans les deux cas.';

// Fourchette d'indemnités lisible, dans l'unité de la borne haute ; null s'il manque une borne.
export function eurRange(low: number | null, high: number | null): string | null {
  if (low === null || high === null) return null;
  const [div, unit, digits] = high >= 1e6 ? [1e6, ' M€', 2] : high >= 1e3 ? [1e3, ' k€', 0] : [1, ' €', 0];
  const fmt = (n: number) => (n / div).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const a = fmt(low), b = fmt(high);
  return a === b ? `${a}${unit}` : `${a} – ${b}${unit}`;
}

// Trains en route (partis, non supprimés) par tranche de retard (minutes) ; retard absent ou négatif = tranche 0.
const BUCKET_FROM_MIN = [0, 1, 5, 15, 30, 60, 120, 180];
// Indice dans TERMINUS_BUCKETS du retard (secondes) ; absent ou négatif = tranche 0.
export function bucketIndex(delay_s: number | undefined): number {
  const min = Math.floor(Math.max(delay_s ?? 0, 0) / 60);
  return BUCKET_FROM_MIN.filter((b) => min >= b).length - 1;
}
const departed = (t: LiveItem, now: Date) => !t.cancelled && Date.parse(t.dep_planned) <= now.getTime();
export function liveBuckets(trains: LiveItem[], now: Date): { bucket: string; n: number }[] {
  const counts = TERMINUS_BUCKETS.map(() => 0);
  for (const t of trains) {
    if (!departed(t, now)) continue;
    counts[bucketIndex(t.delay_s)]++;
  }
  return TERMINUS_BUCKETS.map((bucket, i) => ({ bucket, n: counts[i] }));
}

const HHMM = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

// Les n trains en route qui arrivent le plus tôt : heure prévue + retard publié.
export function nextArrivals(trains: LiveItem[], n: number, now: Date): (LiveItem & { eta: string })[] {
  const at = (t: LiveItem) => Date.parse(t.arr_planned) + (t.delay_s ?? 0) * 1000;
  return trains
    .filter((t) => departed(t, now))
    .sort((a, b) => at(a) - at(b) || a.train_number.localeCompare(b.train_number))
    .slice(0, n)
    .map((t) => ({ ...t, eta: HHMM.format(at(t)) }));
}

// Répartition par marque sur la période ; parts en % de la somme des marques présentes.
export function brandSplit(groups: Group[]): { brand: string; circulated: number; pct: number | null; cost: number; small: boolean; trains_share: number; cost_share: number }[] {
  const by = new Map<string, { circulated: number; on_time: number; cost: number }>();
  for (const g of groups) {
    const a = by.get(g.brand) ?? { circulated: 0, on_time: 0, cost: 0 };
    a.circulated += g.circulated;
    a.on_time += g.on_time_official;
    a.cost += g.estimated_cost_eur_ht;
    by.set(g.brand, a);
  }
  const totalN = [...by.values()].reduce((s, a) => s + a.circulated, 0);
  const totalC = [...by.values()].reduce((s, a) => s + a.cost, 0);
  const share = (v: number, t: number) => (t === 0 ? 0 : Math.round((v / t) * 100));
  return ['INOUI', 'OUIGO'].filter((b) => by.has(b)).map((brand) => {
    const a = by.get(brand)!;
    return {
      brand, circulated: a.circulated, cost: a.cost, small: isSmallSample(a),
      pct: a.circulated === 0 ? null : Math.round((a.on_time / a.circulated) * 1000) / 10,
      trains_share: share(a.circulated, totalN), cost_share: share(a.cost, totalC),
    };
  });
}
