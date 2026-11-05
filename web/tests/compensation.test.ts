import { expect, test } from 'vitest';
import { shapeCumul, type CumulRow } from '../lib/cumul';
import { formLabel, ruleLabel, scaleFor, shapeStats, splitLabel, stepAt, type Price, type Scale } from '../lib/stats';
import { compensationView, thresholdProgress } from '../lib/train-card';
import { shapeWeek, type WeekRow } from '../lib/weekly';
import { delayThresholds, liveEvents } from '../lib/terminal-model';

const row = (brand: string, scope: 'national' | 'international', from_s: number, pct: number, form: 'bon' | 'argent'): Scale =>
  ({ brand, scope, from_s, pct, form, source_url: '', source_as_of: '' });
// Barème en base depuis le 04/11/2026.
const scale: Scale[] = [
  row('INOUI', 'national', 1800, 25, 'bon'), row('INOUI', 'national', 3660, 25, 'argent'),
  row('INOUI', 'national', 7200, 50, 'argent'), row('INOUI', 'national', 10860, 75, 'argent'),
  row('INOUI', 'international', 1800, 25, 'bon'), row('INOUI', 'international', 3660, 25, 'argent'),
  row('INOUI', 'international', 7200, 50, 'argent'),
  row('OUIGO', 'national', 3600, 25, 'bon'), row('OUIGO', 'national', 7200, 50, 'bon'),
];
const prices: Price[] = [
  { brand: 'INOUI', price_eur_ht: 46.6, seats: 556, price_source: '', seats_source: '', as_of: '' },
  { brand: 'OUIGO', price_eur_ht: 34.2, seats: 634, price_source: '', seats_source: '', as_of: '' },
];

test('barème du train : international plafonné, OUIGO international rabattu sur le national', () => {
  expect(stepAt(scale, 'INOUI', 10860)?.pct).toBe(75);
  expect(stepAt(scale, 'INOUI', 10860, true)?.pct).toBe(50);
  expect(scaleFor(scale, 'OUIGO', true).map((s) => s.pct)).toEqual([25, 50]);
  expect(stepAt(scale, 'INOUI', 1740)).toBeNull();
  expect(stepAt(scale, 'INOUI', 1800)?.pct).toBe(25); // « Entre 30 min et 2h : 25 % »
});

test('libellés : règle appliquée et forme du versement', () => {
  expect([ruleLabel('INOUI'), ruleLabel('INOUI', true), ruleLabel('OUIGO', true)])
    .toEqual(['RÈGLE G30 · NATIONAL', 'RÈGLE G30 · INTERNATIONAL', 'RÈGLE OUIGO']);
  expect([formLabel('INOUI', 'bon'), formLabel('OUIGO', 'bon'), formLabel('INOUI', 'argent'), formLabel('INOUI', undefined)])
    .toEqual(['EN BON D’ACHAT', 'BON (CONVERTIBLE EN VIREMENT)', 'EN ARGENT', null]);
  expect(splitLabel(1500.4, 1000)?.replace(/\s/g, ' ')).toBe('1 500 € HT · DONT 1 000 € EN BONS · 500 € EN ARGENT');
  expect(splitLabel(1500, null)).toBeNull();
});

test('fiche train : règle, forme au retard publié, seuils sans le palier de forme de 1 h 01', () => {
  const rules = { compensation_scale: scale, prices };
  expect(compensationView('INOUI', 2400, rules)).toMatchObject({ pct_high: 25, rule: 'RÈGLE G30 · NATIONAL', form: 'EN BON D’ACHAT', next: { from_s: 7200 } });
  expect(compensationView('INOUI', 3900, rules)).toMatchObject({ form: 'EN ARGENT' });
  expect(compensationView('INOUI', 10860, rules, true)).toMatchObject({ pct_low: 50, pct_high: 50, rule: 'RÈGLE G30 · INTERNATIONAL', next: null });
  expect(compensationView('OUIGO', 3600, rules)).toMatchObject({ form: 'BON (CONVERTIBLE EN VIREMENT)' });
  expect(thresholdProgress('INOUI', 7200, rules, true)).toBeNull(); // plafonné : plus de seuil
});

test('stats et cumul : part en bons et écart du plafond, null sans la mesure', () => {
  const rows = [
    { brand: 'INOUI', axis: 'SUD_EST', metric: 'comp_pct_sum', n: 100 },
    { brand: 'INOUI', axis: 'SUD_EST', metric: 'comp_pct_sum_bon', n: 25 },
    { brand: 'INOUI', axis: 'SUD_EST', metric: 'comp_pct_sum_intl_cap', n: 25 },
  ];
  const perPct = (46.6 * 556 * 0.75) / 100;
  const t = shapeStats(rows, prices, scale, { from: '2026-11-01', to: '2026-11-01' }).totals;
  expect(t.estimated_cost_eur_ht_bon).toBeCloseTo(25 * perPct, 1);
  expect(t.intl_cap_eur_ht).toBeCloseTo(25 * perPct, 1);
  expect(shapeStats(rows.slice(0, 1), prices, scale, { from: '2026-11-01', to: '2026-11-01' }).totals.estimated_cost_eur_ht_bon).toBeNull();
  const cumul = (metrics: [string, number][]): CumulRow[] =>
    metrics.map(([metric, n]) => ({ brand: 'INOUI', metric, n, days: 1, first_day: '2026-11-01', last_day: '2026-11-01' }));
  expect(shapeCumul(cumul([['comp_pct_sum', 100], ['comp_pct_sum_bon', 25]]), prices).cost_eur_ht_bon).toBeCloseTo(25 * perPct, 1);
  expect(shapeCumul(cumul([['comp_pct_sum', 100]]), prices).cost_eur_ht_bon).toBeNull();
});

test('bilan figé : part en bons recalculée à part, phrase au-delà de 30 %, note du plafond, totaux inchangés', () => {
  const week = (stats: [string, string, string, number][]): WeekRow => ({
    week: '2026-W44', monday: '2026-10-26', computed_at: '2026-11-02T05:00:00Z',
    payload: { from: '2026-10-26', to: '2026-11-01', monday: '2026-10-26', days: 7, stats, by_day: [], prices,
      scale: scale.map(({ scope, form, ...s }) => s), train: null, heatmap: null },
  });
  const frozen = week([['INOUI', 'SUD_EST', 'circulated', 100], ['INOUI', 'SUD_EST', 'comp_pct_sum', 100]]);
  const v = shapeWeek(frozen, null, { bon: 12000, intl_cap: 4858 });
  expect(v.kpis.cost.value).toBeCloseTo((100 * 46.6 * 556 * 0.75) / 100, 1); // total figé
  expect(v.kpis.cost.bon).toBe(12000);
  expect(v.intlCapNote).toEqual({ from: '04/11', eur: 4858 });
  expect(v.takeaways.some((s) => s.startsWith('62 % des indemnités théoriques'))).toBe(true);
  // Bilan calculé avec le nouveau barème : part en bons dans le bilan lui-même, pas de note.
  const fresh = shapeWeek(week([['INOUI', 'SUD_EST', 'circulated', 100], ['INOUI', 'SUD_EST', 'comp_pct_sum', 100], ['INOUI', 'SUD_EST', 'comp_pct_sum_bon', 20]]), null);
  expect(fresh.intlCapNote).toBeNull();
  expect(fresh.takeaways.some((s) => s.includes('en bons d’achat'))).toBe(false); // 20 % : sous le seuil
});

test('calcul périmé : signalé au-delà de l’âge normal des caches', async () => {
  const { calcLabel, isCalcStale, STATS_MAX_AGE_MIN } = await import('../lib/terminal-model');
  const now = new Date('2026-11-04T10:33:00Z');
  expect(isCalcStale('2026-11-04T09:50:00Z', STATS_MAX_AGE_MIN, now)).toBe(true); // 43 min : la mise à jour échoue
  expect(isCalcStale('2026-11-04T10:10:00Z', STATS_MAX_AGE_MIN, now)).toBe(false);
  expect(calcLabel('2026-11-04T09:50:00Z', STATS_MAX_AGE_MIN, now)).toBe('CALCULÉ À 10:50 · PÉRIMÉ, MISE À JOUR EN ÉCHEC');
  expect(calcLabel('2026-11-04T09:50:00Z')).toBe('CALCULÉ À 10:50');
});

test('INOUI à exactement +30′ : 25 % (« Entre 30 min et 2h : 25 % », SNCF Connect) ; 29′ : rien ; bandeau et calcul alignés', () => {
  expect(stepAt(scale, 'INOUI', 1740)).toBeNull();
  expect(stepAt(scale, 'INOUI', 1799)).toBeNull();
  expect(stepAt(scale, 'INOUI', 1800)?.pct).toBe(25);
  expect(stepAt(scale, 'INOUI', 2100)?.pct).toBe(25);
  // Le bandeau lit le même barème : seuil à 30′, événement dès qu'un train passe à +30′.
  expect(delayThresholds(scale.filter((s) => s.brand === 'INOUI'))[0]).toBe(30);
  const t = (delay_s: number) => ({ trip_id: 'a', service_date: '2026-11-05', brand: 'INOUI', axis: 'SUD_EST', train_number: '1', cancelled: false,
    dep_planned: '2026-11-05T08:00:00Z', arr_planned: '2026-11-05T11:00:00Z', comp_pct: 0, comp_eur_per_passenger_ref: 0, stops: [], delay_s });
  expect(liveEvents([t(1500)], [t(1500)], [30, 60, 120], 9999).events).toEqual([]);
  expect(liveEvents([t(1500)], [t(1800)], [30, 60, 120], 9999).events.map((e) => e.tag)).toEqual(['SEUIL 30′ FRANCHI']);
});
