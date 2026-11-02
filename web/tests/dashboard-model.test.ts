import { expect, test } from 'vitest';
import {
  TERMINUS_BUCKETS, bucketShares, isSmallSample, monthOptions, sortGroups, suppressionPct,
} from '../lib/dashboard-model';
import type { Group } from '../lib/stats';

test('isSmallSample : seuil à 30', () => {
  expect(isSmallSample({ circulated: 29 })).toBe(true);
  expect(isSmallSample({ circulated: 30 })).toBe(false);
  expect(isSmallSample({ circulated: 0 })).toBe(true);
});

test('suppressionPct : arrondi à 0,1, null sans train', () => {
  expect(suppressionPct({ cancelled: 2, circulated: 71 })).toBe(2.7);
  expect(suppressionPct({ cancelled: 0, circulated: 0 })).toBeNull();
  expect(suppressionPct({ cancelled: 5, circulated: 0 })).toBe(100);
});

test('bucketShares : ordre des tranches, pourcentages, total nul, tranche absente', () => {
  const s = bucketShares({ '0-4': 31, '5-14': 9, '15-29': 10, '30-59': 7, '60-119': 12, '120-179': 1, '180+': 1 });
  expect(s.map((x) => x.bucket)).toEqual(TERMINUS_BUCKETS);
  expect(s[0]).toEqual({ bucket: '0-4', n: 31, pct: 43.7 });
  const zero = bucketShares({});
  expect(zero).toHaveLength(7);
  expect(zero.every((x) => x.n === 0 && x.pct === 0)).toBe(true);
  expect(bucketShares({ '0-4': 2, '5-14': 2 }).find((x) => x.bucket === '5-14')).toEqual({ bucket: '5-14', n: 2, pct: 50 });
});

test('monthOptions : du plus récent au plus ancien, heure de Paris, changement d’année', () => {
  expect(monthOptions(new Date('2026-12-15T12:00:00Z'))).toEqual(['2026-12', '2026-11', '2026-10']);
  expect(monthOptions(new Date('2027-01-02T12:00:00Z'))).toEqual(['2027-01', '2026-12', '2026-11', '2026-10']);
  expect(monthOptions(new Date('2026-10-21T12:00:00Z'))).toEqual(['2026-10']);
  expect(monthOptions(new Date('2026-11-30T23:30:00Z'))[0]).toBe('2026-12'); // déjà le 1er décembre à Paris
});

test('sortGroups : marque puis axe, sans modifier l’entrée', () => {
  const g = (brand: string, axis: string) => ({ brand, axis }) as Group;
  const input = [g('OUIGO', 'EST'), g('INOUI', 'SUD_EST'), g('INOUI', 'EST')];
  const sorted = sortGroups(input);
  expect(sorted.map((x) => `${x.brand} ${x.axis}`)).toEqual(['INOUI EST', 'INOUI SUD_EST', 'OUIGO EST']);
  expect(input.map((x) => x.brand)).toEqual(['OUIGO', 'INOUI', 'INOUI']);
});
