import { expect, test } from 'vitest';
import { axisRegularity, bucketBar, bucketIndex, brandSplit, calcLabel, charBar, delayTone, eurRange, liveBuckets, nextArrivals, periodLabel, periodQuery, topDelays, windowLabel, beyondTop, delayThresholds, liveEvents, nextLiveDelayMs, rangeLabel, eurShort, liveGroups, groupTrips, regScaleMin, deltaPts, gare, tickerFeed, bucketHighlight, columnCalc, isCalcStale, STATS_MAX_AGE_MIN, CUMUL_MAX_AGE_MIN } from '../lib/terminal-model';

test('heure du calcul à Paris ; fenêtre glissante seulement pour les périodes en jours', () => {
  expect(calcLabel('2026-11-02T19:08:00Z')).toBe('CALCULÉ À 20:08');
  expect(calcLabel(undefined)).toBeNull();
  expect(windowLabel('7d')).toBe('JOURS COMPLETS · J-7 À J-1 · FENÊTRE DÉCALÉE À MINUIT');
  expect(windowLabel('2026-11')).toBeNull();
});
import { lateCount, type LiveItem } from '../lib/map-model';
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

test('beyondTop : saute le Top 10, libellé avec destination absente omise', () => {
  const l = [
    item({ train_number: 'a', delay_s: 1200, origin: 'Paris', dest: 'Lyon' }),
    item({ train_number: 'b', brand: 'OUIGO', delay_s: 900, origin: 'Paris' }),
    item({ train_number: 'c', delay_s: 600 }),
  ];
  const r = beyondTop(l, 1, 5);
  expect(r.map((x) => x.label)).toEqual(['OUIGO b PARIS', 'INOUI c']);
  expect(r[0].tag).toBe('▼ +15′');
  expect(beyondTop(l, 3, 5)).toEqual([]);
});

test('delayThresholds : minutes du barème, sans doublon, triées', () => {
  expect(delayThresholds([{ from_s: 7200 }, { from_s: 3600 }, { from_s: 1860 }, { from_s: 3600 }])).toEqual([31, 60, 120]);
  expect(delayThresholds([])).toEqual([]);
});

test('liveEvents : seuil le plus haut franchi, suppression, record ; premier relevé sans événement', () => {
  const T = [31, 60, 120];
  const a = item({ trip_id: 'A', train_number: 'A', delay_s: 1500 });
  const b = item({ trip_id: 'B', train_number: 'B', delay_s: 100 });
  const first = liveEvents([], [a, b], T, 0);
  expect(first.events).toEqual([]);
  expect(first.record).toBe(1500);
  const next = [item({ trip_id: 'A', train_number: 'A', delay_s: 4000 }), item({ trip_id: 'B', train_number: 'B', delay_s: 0, cancelled: true })];
  const r = liveEvents([a, b], next, T, first.record);
  expect(r.events.map((e) => e.tag)).toEqual(['SEUIL 60′ FRANCHI', 'SUPPRIMÉ', 'RECORD +67′']);
  expect(r.record).toBe(4000);
  // Rien de nouveau : aucun événement.
  expect(liveEvents(next, next, T, r.record).events).toEqual([]);
});

test('nextLiveDelayMs : après le renouvellement du cache, jamais sous 20 s ni au-delà de la durée du cache', () => {
  const gen = '2026-11-04T10:00:00Z';
  const t = Date.parse(gen);
  expect(nextLiveDelayMs(gen, t + 60_000)).toBe(243_000);
  expect(nextLiveDelayMs(gen, t + 400_000)).toBe(20_000);
  expect(nextLiveDelayMs(gen, t - 100_000)).toBe(300_000);
});

test('rangeLabel : JJ/MM → JJ/MM', () => {
  expect(rangeLabel('2026-10-28', '2026-11-03')).toBe('28/10 → 03/11');
});

test('EN RETARD de la carte = somme des tranches ≥ 5′ de Retards maintenant (même filtre)', () => {
  const ds = [0, 60, 299, 300, 899, 900, 1800, 3600, 7200, 10800, undefined, -120];
  const l = [
    ...ds.map((d, i) => item({ train_number: String(i), delay_s: d })),
    item({ train_number: 'x', delay_s: 5000, cancelled: true }),
    item({ train_number: 'f', delay_s: 5000, dep_planned: '2026-10-22T16:00:00Z' }),
  ];
  const fromBuckets = liveBuckets(l, NOW).slice(1).reduce((s, b) => s + b.n, 0);
  expect(lateCount(l, NOW)).toBe(fromBuckets);
  expect(lateCount(l, NOW)).toBe(7);
});

test('axisRegularity : somme des marques par axe, pourcentage, petit échantillon', () => {
  const g = (brand: string, axis: string, circulated: number, on_time_official: number) => ({ brand, axis, circulated, on_time_official, cancelled: 0, estimated_cost_eur_ht: 0 }) as Group;
  const r = axisRegularity([g('OUIGO', 'ATLANTIQUE', 4, 3), g('INOUI', 'ATLANTIQUE', 19, 14), g('INOUI', 'EST', 0, 0), g('INOUI', 'SUD_EST', 40, 20)]);
  expect(r.map((x) => x.axis)).toEqual(['ATLANTIQUE', 'EST', 'SUD_EST']);
  expect(r[0]).toMatchObject({ axis: 'ATLANTIQUE', circulated: 23, on_time: 17, pct: 73.9, small: true });
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
  const even = bucketBar({ '0-4': 1, '5-14': 1, '60-119': 1 }, 12);
  expect(even.map((s) => [s.i, s.len])).toEqual([[0, 4], [1, 4], [4, 4]]);
  const skew = bucketBar({ '0-4': 99, '180+': 1 }, 12);
  expect(sum(skew)).toBe(12);
  expect(skew.every((s) => s.len > 0)).toBe(true);
  expect(sum(bucketBar({ '0-4': 1, '5-14': 1, '15-29': 1 }, 10))).toBe(10);
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
  expect(r.map((b) => b.bucket)).toEqual(['0-4', '5-14', '15-29', '30-59', '60-119', '120-179', '180+']);
  expect(r.map((b) => b.n)).toEqual([5, 2, 1, 1, 1, 1, 1]);
  expect(liveBuckets([], NOW).map((b) => b.n)).toEqual([0, 0, 0, 0, 0, 0, 0]);
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
  // Arrivée estimée déjà passée : écartée ; un retard la repousse après maintenant : gardée.
  const past = [item({ train_number: 'gone', arr_planned: '2026-10-22T14:50:00Z' }), item({ train_number: 'held', arr_planned: '2026-10-22T14:50:00Z', delay_s: 900 })];
  expect(nextArrivals(past, 8, NOW).map((t) => t.train_number)).toEqual(['held']);
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
    .toEqual([0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 4, 5, 6, 6]);
});

test('eurShort : M€, k€, €', () => {
  expect(eurShort(1015435)).toBe('1,02 M€');
  expect(eurShort(310400)).toBe('310 k€');
  expect(eurShort(840.4)).toBe('840 €');
  expect(eurShort(0)).toBe('0 €');
});

test('liveGroups : 60+ réunit les trois dernières tranches ; groupTrips suit le même filtre', () => {
  const ds = [0, 300, 900, 1800, 3600, 7200, 10800];
  const l = [...ds.map((d, i) => item({ trip_id: `t${i}`, train_number: String(i), delay_s: d })), item({ trip_id: 'x', train_number: 'x', delay_s: 4000, cancelled: true })];
  const g = liveGroups(l, NOW);
  expect(g.map((x) => [x.label, x.n])).toEqual([['0-4', 1], ['5-14', 1], ['15-29', 1], ['30-59', 1], ['60+', 3]]);
  expect(groupTrips(l, NOW, [4, 5, 6])).toEqual(['t4', 't5', 't6']);
});

test('regScaleMin, deltaPts, gare', () => {
  expect(regScaleMin([81.6, 85.7, 76.7])).toBe(70);
  expect(regScaleMin([73.5, 69.1, null])).toBe(60);
  expect(regScaleMin([null])).toBe(70);
  expect(deltaPts(73.3, 82.7)).toBe('−9,4 PTS');
  expect(deltaPts(85, 82.7)).toBe('+2,3 PTS');
  expect(deltaPts(null, 82.7)).toBeNull();
  expect(gare('Paris Montparnasse Hall 1 - 2')).toBe('PARIS MONTP.');
  expect(gare('Saint-Étienne Châteaucreux', 12)).toBe('ST-ÉTIENNE…');
});

test('tickerFeed : jamais un train du Top ; sans événement restant, les trains au-delà du Top', () => {
  const l = [1, 2, 3, 4].map((i) => item({ trip_id: `t${i}`, train_number: String(i), delay_s: 6000 - i * 600 }));
  const ev = (id: string, tag: string) => ({ key: `${id}:${tag}`, trip_id: id, tag, label: id, tone: 'late' as const });
  // Top 2 = t1, t2 : l'événement de t2 disparaît, celui de t3 reste.
  expect(tickerFeed([ev('t2', 'SEUIL 31′ FRANCHI'), ev('t3', 'SUPPRIMÉ')], l, 2, 15).map((e) => e.trip_id)).toEqual(['t3']);
  // Seul événement = record du n°1 : repli sur les trains au-delà du Top.
  expect(tickerFeed([ev('t1', 'RECORD +90′')], l, 2, 15).map((e) => e.trip_id)).toEqual(['t3', 't4']);
});

test('seuil PÉRIMÉ propre à chaque bloc : cumul et jour 15 min, période 40 min', () => {
  expect(CUMUL_MAX_AGE_MIN).toBe(15); // 5 min de cache de données + 5 + 1 min de CDN, avec une marge
  expect(STATS_MAX_AGE_MIN).toBe(40); // 15 min de cache de données + 15 + 5 min de CDN, avec une marge
  const now = new Date('2026-11-05T10:40:00Z');
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
  expect(isCalcStale(ago(14), CUMUL_MAX_AGE_MIN, now)).toBe(false);
  expect(isCalcStale(ago(16), CUMUL_MAX_AGE_MIN, now)).toBe(true);
  expect(isCalcStale(ago(39), STATS_MAX_AGE_MIN, now)).toBe(false);
  expect(isCalcStale(ago(41), STATS_MAX_AGE_MIN, now)).toBe(true);
  // Période de 30 min : normal pour elle ; le même âge rend le cumul périmé.
  expect(columnCalc(ago(30), ago(2), now)).toEqual({ label: 'CALCULÉ À 11:38', stale: false });
  expect(columnCalc(ago(2), ago(30), now)?.stale).toBe(true);
  expect(columnCalc(ago(45), ago(2), now)?.stale).toBe(true);
  expect(columnCalc(undefined, undefined, now)).toBeNull();
});

test('filtre de tranche épinglé : suit les relevés, garde le train sélectionné', () => {
  const before = [item({ trip_id: 'a', train_number: 'a', delay_s: 1000 }), item({ trip_id: 'b', train_number: 'b', delay_s: 2000 })];
  const after = [item({ trip_id: 'a', train_number: 'a', delay_s: 1900 }), item({ trip_id: 'b', train_number: 'b', delay_s: 2000 })];
  // Tranche 30-59 (indice 3) : a y entre au relevé suivant.
  expect(bucketHighlight(before, NOW, [3], null)).toEqual(['b']);
  expect(bucketHighlight(after, NOW, [3], null)).toEqual(['a', 'b']);
  // Tranche 15-29 (indice 2) : a en sort ; s'il est sélectionné, il reste visible.
  expect(bucketHighlight(after, NOW, [2], null)).toEqual([]);
  expect(bucketHighlight(after, NOW, [2], 'a')).toEqual(['a']);
  expect(bucketHighlight(after, NOW, [3], 'a')).toEqual(['a', 'b']);
});
