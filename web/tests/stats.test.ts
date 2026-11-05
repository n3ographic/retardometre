import { expect, test } from 'vitest';
import { DEFAULT_OCCUPANCY, shapeStats, type StatRow } from '../lib/stats';
import { prices, scale } from './fixtures';

const params = { from: '2026-10-01', to: '2026-10-07' };
const r = (brand: string, axis: string, metric: string, n: number): StatRow => ({ brand, axis, metric, n });

test('régularité, coût et totaux', () => {
  const p = shapeStats([
    r('INOUI', 'SUD_EST', 'circulated', 5), r('INOUI', 'SUD_EST', 'on_time_official', 2),
    r('INOUI', 'SUD_EST', 'comp_pct_sum', 50), r('INOUI', 'SUD_EST', 'observed', 7),
  ], prices, scale, params);
  expect(p.from).toBe('2026-10-01');
  expect(p.groups).toHaveLength(1);
  const g = p.groups[0];
  expect(g.brand).toBe('INOUI'); expect(g.axis).toBe('SUD_EST');
  expect(g.official_regularity_pct).toBe(40);
  expect(g.cost_eur_ht_at_full_occupancy).toBeCloseTo(12954.8, 2);
  expect(g.estimated_cost_eur_ht).toBeCloseTo(9716.1, 2);
  expect(p.totals.observed).toBe(7);
  expect(p.totals.estimated_cost_eur_ht).toBeCloseTo(9716.1, 2);
  expect(p.totals.cost_eur_ht_at_full_occupancy).toBeCloseTo(12954.8, 2);
});

test('deux groupes : les totaux additionnent, chaque marque utilise son prix', () => {
  const p = shapeStats([
    r('INOUI', 'SUD_EST', 'comp_pct_sum', 100), r('INOUI', 'SUD_EST', 'circulated', 3),
    r('OUIGO', 'NORD', 'comp_pct_sum', 100), r('OUIGO', 'NORD', 'circulated', 1),
    r('OUIGO', 'NORD', 'on_time_official', 1), r('OUIGO', 'NORD', 'terminus:5-14', 2),
  ], prices, scale, params);
  const inoui = 46.6 * 556 * 0.75, ouigo = 34.2 * 634 * 0.75;
  expect(p.totals.cost_eur_ht_at_full_occupancy).toBe(Math.round((46.6 * 556 + 34.2 * 634) * 100) / 100);
  expect(p.groups.map((g) => g.brand)).toEqual(['INOUI', 'OUIGO']);
  expect(p.groups[0].estimated_cost_eur_ht).toBeCloseTo(inoui, 2);
  expect(p.groups[1].estimated_cost_eur_ht).toBeCloseTo(ouigo, 2);
  expect(p.totals.estimated_cost_eur_ht).toBeCloseTo(inoui + ouigo, 2);
  expect(p.totals.circulated).toBe(4);
  expect(p.totals.official_regularity_pct).toBe(25);
  expect(p.totals.terminus_buckets['5-14']).toBe(2);
});

test('période vide : zéros, null, pas de NaN', () => {
  const p = shapeStats([], prices, scale, params);
  expect(p.groups).toEqual([]); expect(p.totals.official_regularity_pct).toBeNull();
  expect(JSON.stringify(p)).not.toContain('NaN'); expect(p.totals.estimated_cost_eur_ht).toBe(0); expect(p.totals.cost_eur_ht_at_full_occupancy).toBe(0);
});

test('les tranches absentes valent 0 et toutes les clés sont présentes', () => {
  const p = shapeStats([r('INOUI', 'EST', 'stop:cancelled', 4), r('INOUI', 'EST', 'terminus:180+', 1)], prices, scale, params);
  const keys = ['0-4', '5-14', '15-29', '30-59', '60-119', '120-179', '180+'];
  expect(Object.keys(p.groups[0].terminus_buckets)).toEqual(keys);
  expect(Object.keys(p.groups[0].stop_buckets)).toEqual([...keys, 'cancelled']);
  expect(p.groups[0].terminus_buckets['180+']).toBe(1);
  expect(p.groups[0].terminus_buckets['0-4']).toBe(0);
  const m = shapeStats([r('INOUI', 'EST', 'terminus:0', 3), r('INOUI', 'EST', 'terminus:1-4', 1), r('INOUI', 'EST', 'stop:1-4', 2)], prices, scale, params);
  expect(m.groups[0].terminus_buckets['0-4']).toBe(4); // 0 et 1-4 de la base réunies
  expect(m.totals.stop_buckets['0-4']).toBe(2);
  expect(p.totals.stop_buckets.cancelled).toBe(4);
});

test('métriques inconnues ignorées, nombres en chaîne convertis', () => {
  const p = shapeStats([r('INOUI', 'EST', 'mystery', 9), { brand: 'INOUI', axis: 'EST', metric: 'planned', n: '12' as unknown as number }], prices, scale, params);
  expect(p.totals.planned).toBe(12);
  expect(JSON.stringify(p)).not.toContain('mystery');
});

test('valeur non numérique : erreur plutôt que NaN', () => {
  expect(() => shapeStats([{ brand: 'INOUI', axis: 'EST', metric: 'planned', n: 'x' as unknown as number }], prices, scale, params)).toThrow();
});

test('hypothèses : occupation, prix et barème triés par marque puis palier', () => {
  const p = shapeStats([], prices, scale, params);
  expect(p.assumptions.occupancy).toBe(0.75);
  expect(DEFAULT_OCCUPANCY).toBe(0.75);
  expect(p.assumptions.prices.map((x) => x.brand)).toEqual(['INOUI', 'OUIGO']);
  expect(p.assumptions.compensation_scale.map((x) => `${x.brand}:${x.from_s}`)).toEqual(['INOUI:1800', 'INOUI:7200', 'OUIGO:3600']);
});

test('hypothèses : prix et barème convertis en nombres', () => {
  const p = shapeStats([], [{ ...prices[1], price_eur_ht: '46.60' as unknown as number, seats: '556' as unknown as number }],
    [{ ...scale[0], from_s: '3600' as unknown as number, pct: '25' as unknown as number }], params);
  expect(p.assumptions.prices[0]).toMatchObject({ price_eur_ht: 46.6, seats: 556 });
  expect(p.assumptions.compensation_scale[0]).toMatchObject({ from_s: 3600, pct: 25 });
});

test('fourchette : le coût bas et le coût haut suivent leurs pourcentages, le central ne change pas', () => {
  const p = shapeStats([
    r('INOUI', 'SUD_EST', 'comp_pct_sum', 50), r('INOUI', 'SUD_EST', 'comp_pct_sum_low', 25), r('INOUI', 'SUD_EST', 'comp_pct_sum_high', 100),
  ], prices, scale, params);
  const full = 46.6 * 556; // un train indemnisé à 100 %, rame pleine
  const g = p.groups[0];
  expect(g.estimated_cost_eur_ht).toBeCloseTo(0.5 * full * DEFAULT_OCCUPANCY, 2);
  expect(g.estimated_cost_eur_ht_low).toBeCloseTo(0.25 * full * DEFAULT_OCCUPANCY, 2);
  expect(g.estimated_cost_eur_ht_high).toBeCloseTo(1.0 * full * DEFAULT_OCCUPANCY, 2);
  expect(p.totals.estimated_cost_eur_ht_low).toBeCloseTo(g.estimated_cost_eur_ht_low!, 2);
  expect(p.totals.estimated_cost_eur_ht_high).toBeCloseTo(g.estimated_cost_eur_ht_high!, 2);
});

test('fourchette : deux marques, chacune avec son prix, les totaux additionnent', () => {
  const p = shapeStats([
    r('INOUI', 'SUD_EST', 'comp_pct_sum_low', 100), r('INOUI', 'SUD_EST', 'comp_pct_sum_high', 100),
    r('OUIGO', 'NORD', 'comp_pct_sum_low', 50), r('OUIGO', 'NORD', 'comp_pct_sum_high', 100),
  ], prices, scale, params);
  const inoui = 46.6 * 556 * 0.75, ouigo = 34.2 * 634 * 0.75;
  expect(p.totals.estimated_cost_eur_ht_low).toBeCloseTo(inoui + 0.5 * ouigo, 2);
  expect(p.totals.estimated_cost_eur_ht_high).toBeCloseTo(inoui + ouigo, 2);
});

test('fourchette absente des lignes (ancienne réponse) : bas et haut valent null, pas 0', () => {
  const p = shapeStats([r('INOUI', 'SUD_EST', 'comp_pct_sum', 50), r('INOUI', 'SUD_EST', 'circulated', 5)], prices, scale, params);
  expect(p.groups[0].estimated_cost_eur_ht_low).toBeNull();
  expect(p.groups[0].estimated_cost_eur_ht_high).toBeNull();
  expect(p.totals.estimated_cost_eur_ht_low).toBeNull();
  expect(p.totals.estimated_cost_eur_ht_high).toBeNull();
});

test('retards aberrants et arrêts sautés : comptés dans les totaux', () => {
  const p = shapeStats([r('INOUI', 'EST', 'aberrant', 1), r('INOUI', 'SUD_EST', 'aberrant', 2), r('INOUI', 'EST', 'skipped_stop', 4)], prices, scale, params);
  expect(p.totals.aberrant).toBe(3);
  expect(p.totals.skipped_stop).toBe(4);
});

test('les constantes de la règle sont publiées avec les hypothèses', () => {
  const p = shapeStats([], prices, scale, params);
  expect(p.assumptions.range).toEqual({ delay_tolerance_s: 299, aberrant_delay_s: 43200 });
});

test('cause_breakdown : coût par marque, tri par coût puis trains, catégories vides omises', () => {
  const p = shapeStats([
    r('INOUI', 'SUD_EST', 'cause:meteo', 2), r('INOUI', 'SUD_EST', 'cause_delay_s:meteo', 2460), r('INOUI', 'SUD_EST', 'cause_comp:meteo', 25),
    r('OUIGO', 'NORD', 'cause:meteo', 1), r('OUIGO', 'NORD', 'cause_delay_s:meteo', 3600), r('OUIGO', 'NORD', 'cause_comp:meteo', 25),
    r('INOUI', 'SUD_EST', 'cause:regulation', 3), r('INOUI', 'SUD_EST', 'cause_delay_s:regulation', 1800), r('INOUI', 'SUD_EST', 'cause_comp:regulation', 0),
    r('INOUI', 'SUD_EST', 'cause:autre', 0),
  ], prices, scale, params);
  const cost = Math.round((0.25 * 46.6 * 556 * 0.75 + 0.25 * 34.2 * 634 * 0.75) * 100) / 100;
  expect(p.cause_breakdown).toEqual([
    { category: 'meteo', trains: 3, avg_delay_min: 34, cost_eur_ht: cost },
    { category: 'regulation', trains: 3, avg_delay_min: 10, cost_eur_ht: 0 },
  ]);
});

test('sans mesures de cause (ancienne réponse) : cause_breakdown vide', () => {
  expect(shapeStats([r('INOUI', 'SUD_EST', 'circulated', 1)], prices, scale, params).cause_breakdown).toEqual([]);
});
