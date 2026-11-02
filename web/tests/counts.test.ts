import { expect, test } from 'vitest';
import { breakdownText } from '../lib/counts';
import { shapeCumul } from '../lib/cumul';

test('décomposition : ordre fixe, catégories rares à zéro omises', () => {
  // toLocaleString('fr-FR') sépare les milliers par une espace fine insécable.
  expect(breakdownText({ observed: 7301, circulated: 7104, cancelled: 90, no_terminus: 106, aberrant: 1 }).replace(/ /g, ' '))
    .toBe('7 301 OBSERVÉS · 7 104 ONT ROULÉ · 90 SUPPR. · 106 TERMINUS NON DESSERVI · 1 ABERRANT');
  expect(breakdownText({ observed: 450, circulated: 448, cancelled: 2, no_terminus: 0, aberrant: 0 }))
    .toBe('450 OBSERVÉS · 448 ONT ROULÉ · 2 SUPPR.');
});

test('cumul : les quatre catégories somment aux observés', () => {
  const row = (metric: string, n: number) => ({ brand: 'INOUI', metric, n, days: 1, first_day: '2026-10-20', last_day: '2026-10-20' });
  const c = shapeCumul(['observed:20', 'circulated:15', 'cancelled:2', 'no_terminus:2', 'aberrant:1'].map((s) => row(s.split(':')[0], Number(s.split(':')[1]))),
    [{ brand: 'INOUI', price_eur_ht: 50, seats: 500, price_source: '', seats_source: '', as_of: '' }]);
  expect(c.circulated + c.cancelled + c.no_terminus + c.aberrant).toBe(c.observed);
});
