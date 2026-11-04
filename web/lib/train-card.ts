import type { SegmentProgress } from './position';
import { RANGE, scaleFor, type Price, type Scale } from './stats';

export type Rules = { compensation_scale: Scale[]; prices: Price[] };

// Le retard est publié par pas de 5 min : le retard réel est à moins de 299 s du retard publié, dans un sens inconnu.
export function delayBounds(delay_s: number): { low_s: number; high_s: number } {
  return { low_s: Math.max(delay_s - RANGE.delay_tolerance_s, 0), high_s: delay_s + RANGE.delay_tolerance_s };
}

const pctAt = (scale: Scale[], brand: string, d: number) =>
  scaleFor(scale, brand).reduce((m, s) => (s.from_s <= d ? Math.max(m, s.pct) : m), 0);
// Seuils où le pourcentage change (le palier de 1 h 01 ne change que la forme, bon → argent).
const pctMarks = (scale: Scale[], brand: string) =>
  scaleFor(scale, brand).filter((s, i, all) => i === 0 || s.pct !== all[i - 1].pct);

export type CompensationView = {
  pct_low: number; pct_high: number; eur_low: number; eur_high: number; // € HT par voyageur, à l'occupation près
  next: { from_s: number; pct: number; in_s: number } | null; // prochain seuil au-dessus du retard publié
};

export function compensationView(brand: string, delay_s: number | undefined, rules: Rules): CompensationView | null {
  const price = rules.prices.find((p) => p.brand === brand);
  if (!price) return null;
  const d = Math.max(delay_s ?? 0, 0);
  const { low_s, high_s } = delayBounds(d);
  const pct_low = pctAt(rules.compensation_scale, brand, low_s);
  const pct_high = pctAt(rules.compensation_scale, brand, high_s);
  const eur = (pct: number) => Math.round(pct * price.price_eur_ht) / 100;
  const above = pctMarks(rules.compensation_scale, brand).find((s) => s.from_s > d);
  return {
    pct_low, pct_high, eur_low: eur(pct_low), eur_high: eur(pct_high),
    next: above ? { from_s: above.from_s, pct: above.pct, in_s: above.from_s - d } : null,
  };
}

// Minutes depuis la dernière observation du train par le collecteur ; null si inconnue.
export function observedAgo(last_seen_at: string | undefined, now: Date): number | null {
  const seen = last_seen_at === undefined ? NaN : Date.parse(last_seen_at);
  if (!Number.isFinite(seen)) return null;
  return Math.max(0, Math.round((now.getTime() - seen) / 60000)) || 0;
}

// Avancement du retard publié entre le seuil du palier en cours (0 avant le premier) et le prochain seuil ; null au dernier palier ou sans barème.
export function thresholdProgress(brand: string, delay_s: number | undefined, rules: Rules): { from_s: number; to_s: number; ratio: number } | null {
  const marks = pctMarks(rules.compensation_scale, brand).map((s) => s.from_s);
  const d = Math.max(delay_s ?? 0, 0);
  const to_s = marks.find((m) => m > d);
  if (to_s === undefined) return null;
  const from_s = marks.filter((m) => m <= d).pop() ?? 0;
  return { from_s, to_s, ratio: (d - from_s) / (to_s - from_s) };
}

// Sous ce seuil, la moyenne d'un tronçon (approches urbaines, ex. Lyon Part-Dieu → Perrache : 5 km en 8 à 12 min)
// n'est pas une vitesse de TGV : on ne l'affiche pas comme telle.
export const MIN_SPEED_KMH = 60;

// À moins de 3 min d'un arrêt, le train freine ou démarre (à 237 km/h, le freinage seul prend environ 2 min) :
// la moyenne du tronçon ne dit rien de sa vitesse. Au-delà de +10 min annoncées sur le tronçon, il roule moins vite que prévu.
export const NEAR_STOP_S = 180;
export const RISING_DELAY_S = 600;

export type SpeedView =
  | { kind: 'none' } | { kind: 'approach'; stop?: string } | { kind: 'departure'; stop?: string } | { kind: 'short' }
  | { kind: 'speed'; kmh: number; rising: boolean };
export function speedView(speed: number | null, p?: SegmentProgress | null): SpeedView {
  if (speed === null) return { kind: 'none' };
  if (p && p.toArrS < NEAR_STOP_S) return { kind: 'approach', stop: p.to };
  if (p && p.sinceDepS < NEAR_STOP_S) return { kind: 'departure', stop: p.from };
  if (speed < MIN_SPEED_KMH) return { kind: 'short' };
  return { kind: 'speed', kmh: Math.round(speed), rising: (p?.growthS ?? 0) >= RISING_DELAY_S };
}
