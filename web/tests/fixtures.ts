import type { Price, Scale } from '../lib/stats';

export const prices: Price[] = [
  { brand: 'OUIGO', price_eur_ht: 34.2, seats: 634, price_source: 's', seats_source: 's', as_of: '2023-12-31' },
  { brand: 'INOUI', price_eur_ht: 46.6, seats: 556, price_source: 's', seats_source: 's', as_of: '2023-12-31' },
];
export const scale: Scale[] = [
  { brand: 'OUIGO', from_s: 3600, pct: 25, source_url: 'u', source_as_of: '2026-09-04' },
  { brand: 'INOUI', from_s: 7200, pct: 50, source_url: 'u', source_as_of: '2026-06-17' },
  { brand: 'INOUI', from_s: 1800, pct: 25, source_url: 'u', source_as_of: '2026-06-17' },
];
