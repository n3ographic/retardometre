import type { Group } from './stats';

// En dessous, un effectif est trop petit pour que le pourcentage dise quelque chose : affiché, mais estompé.
export const SAMPLE_MIN = 30;

// Tranches de retard affichées (minutes) : 0-4 réunit 0 et 1-4, les retards étant publiés par pas de 5 min.
export const TERMINUS_BUCKETS = ['0-4', '5-14', '15-29', '30-59', '60-119', '120-179', '180+'];

const round1 = (n: number) => Math.round(n * 10) / 10;

export function isSmallSample(t: { circulated: number }): boolean {
  return t.circulated < SAMPLE_MIN;
}

// Suppressions rapportées aux trains prévus et observés (circulés + supprimés).
export function suppressionPct(t: { cancelled: number; circulated: number }): number | null {
  const d = t.cancelled + t.circulated;
  return d === 0 ? null : round1((t.cancelled / d) * 100);
}

export function bucketShares(buckets: Record<string, number>): { bucket: string; n: number; pct: number }[] {
  const total = TERMINUS_BUCKETS.reduce((s, b) => s + (buckets[b] ?? 0), 0);
  return TERMINUS_BUCKETS.map((bucket) => {
    const n = buckets[bucket] ?? 0;
    return { bucket, n, pct: total === 0 ? 0 : round1((n / total) * 100) };
  });
}

// Mois AAAA-MM du plus récent (selon la date à Paris) au plus ancien, jusqu'à `first` inclus.
export function monthOptions(now: Date, first = '2026-10'): string[] {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).formatToParts(now);
  let y = Number(parts.find((p) => p.type === 'year')!.value);
  let m = Number(parts.find((p) => p.type === 'month')!.value);
  const out: string[] = [];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    if (key < first) return out;
    out.push(key);
    if (--m === 0) { m = 12; y--; }
  }
}

export function sortGroups(groups: Group[]): Group[] {
  return [...groups].sort((a, b) => a.brand.localeCompare(b.brand) || a.axis.localeCompare(b.axis));
}
