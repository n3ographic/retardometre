import { expect, test } from 'vitest';
import { axisRegularity, bucketBar, bucketIndex, brandSplit, charBar, collectStatus, delayTone, eurRange, liveBuckets, nextArrivals, periodLabel, periodQuery, tickerItems, topDelays } from '../lib/terminal-model';
import type { LiveItem } from '../lib/map-model';
import type { Group } from '../lib/stats';

const NOW = new Date('2026-10-22T15:00:00Z');
const item = (over: Partial<LiveItem>): LiveItem => ({
  trip_id: over.train_number ?? 't', service_date: '2026-10-22', brand: 'INOUI', axis: 'SUD_EST', train_number: '1', cancelled: false,
  dep_planned: '2026-10-22T13:00:00Z', arr_planned: '2026-10-22T17:00:00Z', comp_pct: 0, comp_eur_per_passenger_ref: 0,
  last_seen_at: '2026-10-22T14:58:00Z', stops: [], ...over,
});

test('delayTone : seuils 5, 30 et 60 min, annulé prioritaire', () => {
  const t = (d?: number, c = false) => delayTone(d, c);
  expect([t(299), t(300), t(1799), t(1800), t(3599), t(3600), t(undefined)]).toEqual(['ontime', 'late', 'late', 'strong', 'strong', 'severe', 'ontime']);
  expect(t(9000, true)).toBe('cancelled');
});

test('topDelays : sans annulés ni retards nuls, tri décroissant, coupe à n', () => {
  const l = [
    item({ train_number: 'a', delay_s: 6000 }), item({ train_number: 'b', delay_s: 13800 }), item({ train_number: 'c', delay_s: 10200 }),
    item({ train_number: 'x', delay_s: 20000, cancelled: true }), item({ train_number: 'z', delay_s: 0 }), item({ train_number: 'n' }),
  ];
  expect(topDelays(l, 10).map((t) => t.train_number)).toEqual(['b', 'c', 'a']);
  expect(topDelays(l, 2).map((t) => t.train_number)).toEqual(['b', 'c']);
  expect(topDelays([], 10)).toEqual([]);
});

test('tickerItems : libellé, minutes arrondies, destination absente omise', () => {
  const [a, b] = tickerItems([
    item({ trip_id: 'T1', train_number: '9713', origin: 'Paris', dest: 'Barcelone', delay_s: 13800 }),
    item({ trip_id: 'T2', brand: 'OUIGO', train_number: '7825', origin: 'Paris', delay_s: 10230 }),
  ], 5);
  expect(a).toEqual({ trip_id: 'T1', label: 'INOUI 9713 Paris → Barcelone', minutes: 230, tone: 'severe', href: '/marey?axe=SUD_EST&train=9713' });
  expect(b.label).toBe('OUIGO 7825 Paris');
  expect(b.minutes).toBe(171);
  // Lien vers le Marey pour tous les axes ouverts dans la vue F3.
  expect(tickerItems([item({ axis: 'INTERSECTEURS', train_number: '5100', delay_s: 2400 })], 1)[0].href).toBe('/marey?axe=INTERSECTEURS&train=5100');
  expect(tickerItems([item({ axis: 'ATLANTIQUE', train_number: '8537', delay_s: 2400 })], 1)[0].href).toBe('/marey?axe=ATLANTIQUE&train=8537');
});

test('collectStatus : moins de 10 minutes OK, au-delà en retard, rien : inconnu', () => {
  expect(collectStatus([item({ last_seen_at: '2026-10-22T14:51:00Z' }), item({ last_seen_at: '2026-10-22T14:40:00Z' })], NOW)).toEqual({ status: 'ok', ageMin: 9 });
  expect(collectStatus([item({ last_seen_at: '2026-10-22T14:49:00Z' })], NOW)).toEqual({ status: 'late', ageMin: 11 });
  expect(collectStatus([], NOW)).toEqual({ status: 'unknown', ageMin: null });
});

test('axisRegularity : somme des marques par axe, pourcentage, petit échantillon', () => {
  const g = (brand: string, axis: string, circulated: number, on_time_official: number) => ({ brand, axis, circulated, on_time_official }) as Group;
  const r = axisRegularity([g('OUIGO', 'ATLANTIQUE', 4, 3), g('INOUI', 'ATLANTIQUE', 19, 14), g('INOUI', 'EST', 0, 0), g('INOUI', 'SUD_EST', 40, 20)]);
  expect(r.map((x) => x.axis)).toEqual(['ATLANTIQUE', 'EST', 'SUD_EST']);
  expect(r[0]).toEqual({ axis: 'ATLANTIQUE', circulated: 23, on_time: 17, pct: 73.9, small: true });
  expect(r[1]).toMatchObject({ pct: null, small: true });
  expect(r[2]).toMatchObject({ pct: 50, small: false });
});

test('charBar : pleins et demi-cellule, vide à 0 ou null', () => {
  expect(charBar(100, 10)).toBe('█'.repeat(10));
  expect(charBar(50, 10)).toBe('█'.repeat(5));
  expect(charBar(55, 10)).toBe('█'.repeat(5) + '▌');
  expect(charBar(0, 10)).toBe('');
  expect(charBar(null, 10)).toBe('');
});

test('periodQuery : jours en period, mois en month', () => {
  expect(periodQuery('7d')).toBe('period=7d');
  expect(periodQuery('31d')).toBe('period=31d');
  expect(periodQuery('2026-10')).toBe('month=2026-10');
});

test('periodLabel : 7J, 14J, 31J, mois abrégé en majuscules', () => {
  expect(['7d', '14d', '31d'].map(periodLabel)).toEqual(['7J', '14J', '31J']);
  expect(periodLabel('2026-10')).toBe('OCT. 2026');
  expect(periodLabel('2027-02')).toBe('FÉVR. 2027');
  expect(periodLabel('2027-05')).toBe('MAI 2027');
});

test('bucketBar : largeur exacte, plus forts restes, vide sans train', () => {
  const sum = (s: { len: number }[]) => s.reduce((a, x) => a + x.len, 0);
  expect(bucketBar({}, 12)).toEqual([]);
  const even = bucketBar({ '0': 1, '5-14': 1, '60-119': 1 }, 12);
  expect(even.map((s) => [s.i, s.len])).toEqual([[0, 4], [2, 4], [5, 4]]);
  const skew = bucketBar({ '0': 99, '180+': 1 }, 12);
  expect(sum(skew)).toBe(12);
  expect(skew.every((s) => s.len > 0)).toBe(true);
  expect(sum(bucketBar({ '0': 1, '1-4': 1, '5-14': 1 }, 10))).toBe(10);
});

test('eurRange : millions à deux décimales, milliers entiers, euros entiers', () => {
  expect(eurRange(2024633, 2783488)).toBe('2,02 – 2,78 M€');
  expect(eurRange(580400, 719600)).toBe('580 – 720 k€');
  expect(eurRange(120.4, 180.2)).toBe('120 – 180 €');
});

test('eurRange : bornes égales une fois arrondies, bornes manquantes', () => {
  expect(eurRange(0, 0)).toBe('0 €');
  expect(eurRange(2000000, 2000001)).toBe('2,00 M€');
  expect(eurRange(null, 2000000)).toBeNull();
  expect(eurRange(2000000, null)).toBeNull();
  expect(eurRange(null, null)).toBeNull();
});

test('liveBuckets : tranches des retards en minutes, supprimés et trains pas encore partis écartés, retard absent ou négatif à 0', () => {
  const ds = [0, 60, 299, 300, 899, 900, 1800, 3600, 7200, 10800, undefined, -120];
  const l = [...ds.map((d, i) => item({ train_number: String(i), delay_s: d })), item({ train_number: 'x', delay_s: 5000, cancelled: true }), item({ train_number: 'f', delay_s: 5000, dep_planned: '2026-10-22T16:00:00Z' })];
  const r = liveBuckets(l, NOW);
  expect(r.map((b) => b.bucket)).toEqual(['0', '1-4', '5-14', '15-29', '30-59', '60-119', '120-179', '180+']);
  expect(r.map((b) => b.n)).toEqual([3, 2, 2, 1, 1, 1, 1, 1]);
  expect(liveBuckets([], NOW).map((b) => b.n)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});

test('nextArrivals : tri par heure estimée puis numéro, supprimés et trains pas encore partis écartés, coupe à n', () => {
  const l = [
    item({ train_number: 'late', arr_planned: '2026-10-22T17:00:00Z', delay_s: 3600 }),
    item({ train_number: 'b', arr_planned: '2026-10-22T17:30:00Z' }),
    item({ train_number: 'a', arr_planned: '2026-10-22T17:30:00Z' }),
    item({ train_number: 'x', arr_planned: '2026-10-22T16:00:00Z', cancelled: true }),
    item({ train_number: 'f', arr_planned: '2026-10-22T15:30:00Z', dep_planned: '2026-10-22T15:10:00Z' }),
  ];
  const r = nextArrivals(l, 8, NOW);
  expect(r.map((t) => t.train_number)).toEqual(['a', 'b', 'late']);
  expect(r.map((t) => t.eta)).toEqual(['19:30', '19:30', '20:00']);
  expect(nextArrivals(l, 2, NOW)).toHaveLength(2);
  expect(nextArrivals([], 8, NOW)).toEqual([]);
});

test('brandSplit : régularité, indemnités et parts par marque ; marque absente omise', () => {
  const g = (brand: string, axis: string, circulated: number, on_time_official: number, estimated_cost_eur_ht: number) =>
    ({ brand, axis, circulated, on_time_official, estimated_cost_eur_ht }) as Group;
  const r = brandSplit([g('INOUI', 'EST', 300, 210, 6000), g('INOUI', 'NORD', 100, 70, 2000), g('OUIGO', 'EST', 100, 80, 2000)]);
  expect(r).toEqual([
    { brand: 'INOUI', circulated: 400, pct: 70, cost: 8000, small: false, trains_share: 80, cost_share: 80 },
    { brand: 'OUIGO', circulated: 100, pct: 80, cost: 2000, small: false, trains_share: 20, cost_share: 20 },
  ]);
  expect(brandSplit([g('INOUI', 'EST', 100, 70, 2000)]).map((b) => [b.brand, b.trains_share])).toEqual([['INOUI', 100]]);
  expect(brandSplit([])).toEqual([]);
  const z = brandSplit([g('OUIGO', 'EST', 0, 0, 0)]);
  expect(z[0]).toMatchObject({ pct: null, small: true, trains_share: 0, cost_share: 0 });
});

test('bucketIndex : indice de la tranche de TERMINUS_BUCKETS pour un retard en secondes', () => {
  expect([undefined, -5, 0, 59, 60, 299, 300, 899, 900, 1800, 3600, 7200, 10800, 99999].map(bucketIndex))
    .toEqual([0, 0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 7]);
});
