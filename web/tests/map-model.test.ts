import { expect, test } from 'vitest';
import { applyFilters, axes, delayClass, isStale, lateCount, toFeatureCollection, trainPosition, type LiveItem } from '../lib/map-model';

const NOW = new Date('2026-11-02T11:30:00Z');
const item = (over: Partial<LiveItem> = {}): LiveItem => ({
  trip_id: 't', service_date: '2026-11-02', brand: 'INOUI', axis: 'SUD_EST', train_number: '1', cancelled: false,
  dep_planned: '2026-11-02T11:00:00Z', arr_planned: '2026-11-02T12:00:00Z', comp_pct: 0, comp_eur_per_passenger_ref: 0,
  last_seen_at: '2026-11-02T11:29:00Z',
  stops: [{ seq: 1, lon: 2, lat: 48, dep: '2026-11-02T11:00:00Z' }, { seq: 2, lon: 4, lat: 46, arr: '2026-11-02T12:00:00Z' }],
  ...over,
});

test('delayClass : seuils 300 s et 1800 s, annulé prioritaire', () => {
  const c = (delay_s?: number, cancelled = false) => delayClass({ delay_s, cancelled });
  expect([c(299), c(300), c(1799), c(1800), c(undefined), c(-60)]).toEqual(['ontime', 'late', 'late', 'severe', 'ontime', 'ontime']);
  expect(c(4000, true)).toBe('cancelled');
});

test('applyFilters : marque, axe, les deux, aucun résultat', () => {
  const l = [item({ brand: 'INOUI', axis: 'EST' }), item({ brand: 'OUIGO', axis: 'EST' }), item({ brand: 'OUIGO', axis: 'SUD_EST' })];
  expect(applyFilters(l, { brand: 'ALL', axis: 'ALL' })).toHaveLength(3);
  expect(applyFilters(l, { brand: 'OUIGO', axis: 'ALL' })).toHaveLength(2);
  expect(applyFilters(l, { brand: 'ALL', axis: 'EST' })).toHaveLength(2);
  expect(applyFilters(l, { brand: 'INOUI', axis: 'SUD_EST' })).toEqual([]);
});

test('axes : distincts et triés ; vide', () => {
  expect(axes([item({ axis: 'SUD_EST' }), item({ axis: 'EST' }), item({ axis: 'SUD_EST' })])).toEqual(['EST', 'SUD_EST']);
  expect(axes([])).toEqual([]);
});

test('lateCount : late et severe seulement, partis et non supprimés', () => {
  const l = [item({ delay_s: 0 }), item({ delay_s: 400 }), item({ delay_s: 2000 }), item({ delay_s: 5000, cancelled: true }),
    item({ delay_s: 5000, dep_planned: '2026-11-02T12:00:00Z' })];
  expect(lateCount(l, NOW)).toBe(2);
  expect(lateCount([], NOW)).toBe(0);
});

test('isStale : 600 s, absent', () => {
  expect(isStale({ last_seen_at: '2026-11-02T11:20:01Z' }, NOW)).toBe(false);
  expect(isStale({ last_seen_at: '2026-11-02T11:19:59Z' }, NOW)).toBe(true);
  expect(isStale({}, NOW)).toBe(true);
});

test('toFeatureCollection : coordonnées, propriétés, trains sans position omis', () => {
  const fc = toFeatureCollection([item({ trip_id: 'a', delay_s: 400 }), item({ trip_id: 'b', stops: [] })], NOW);
  expect(fc.features).toHaveLength(1);
  const [f] = fc.features;
  // retard 400 s : progression (11:30−11:06:40)/60 min = 0,3889
  expect(f.geometry.coordinates[0]).toBeCloseTo(2 + 2 * (1400 / 3600));
  expect(f.geometry.coordinates[1]).toBeCloseTo(48 - 2 * (1400 / 3600), 1); // interpolée en Mercator
  expect(f.properties).toEqual({ trip_id: 'a', cls: 'late', stale: false, state: 'moving', label: '1' }); // label : numéro affiché à côté du point aux zooms élevés
  expect(toFeatureCollection([], NOW).features).toEqual([]);
});

test('toFeatureCollection suit le tracé fourni', () => {
  const path = (): [number, number][] => [[2, 48], [2, 46], [4, 46]]; // deux côtés de 2° : milieu = coude vers [2, 46]
  const [f] = toFeatureCollection([item({ delay_s: 0 })], NOW, path).features;
  expect(f.geometry.coordinates[0]).toBeGreaterThan(1.9);
  expect(f.geometry.coordinates[0]).toBeLessThan(3);
  expect(f.geometry.coordinates[1]).toBeLessThan(47.9);
});

test('trainPosition : un train en mouvement a une position différente à deux instants, entre ses deux arrêts', () => {
  const l = [item({ trip_id: 'a' }), item({ trip_id: 'b' })];
  const p1 = trainPosition(l, 'a', new Date('2026-11-02T11:15:00Z'))!;
  const p2 = trainPosition(l, 'a', new Date('2026-11-02T11:45:00Z'))!;
  expect(p1).not.toEqual(p2);
  expect(p2[0]).toBeGreaterThan(p1[0]); // vers l'est
  for (const p of [p1, p2]) { expect(p[0]).toBeGreaterThan(2); expect(p[0]).toBeLessThan(4); }
});

test('trainPosition : train inconnu ou sans position estimable : null', () => {
  const l = [item({ trip_id: 'a' }), item({ trip_id: 'vide', stops: [] })];
  expect(trainPosition(l, 'inconnu', NOW)).toBeNull();
  expect(trainPosition(l, 'vide', NOW)).toBeNull();
});

test('trainPosition : suit le tracé fourni, comme les points de la carte', () => {
  const detour = (a: [number, number], b: [number, number]) => [a, [a[0], b[1]], b] as [number, number][];
  const l = [item({ trip_id: 'a' })];
  const at = new Date('2026-11-02T11:15:00Z');
  const p = trainPosition(l, 'a', at, detour)!;
  const f = toFeatureCollection(l, at, detour).features[0].geometry.coordinates;
  expect(p).toEqual(f);
});
