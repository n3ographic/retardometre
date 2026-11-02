import { expect, test } from 'vitest';
import { isForeign, layoutLabels, pickLabels, shortName } from '../lib/marey-layout';

test('shortName : abréviations voulues, règles génériques, troncature au séparateur avec « … »', () => {
  expect(shortName('Paris Montparnasse Hall 1 - 2')).toBe('PARIS MONTP.');
  expect(shortName('Bordeaux Saint-Jean')).toBe('BORDEAUX ST-JEAN');
  expect(shortName('Lyon Part Dieu')).toBe('LYON PART-DIEU');
  expect(shortName('Saint-Brieuc')).toBe('ST-BRIEUC');
  expect(shortName('Nantes')).toBe('NANTES');
  const long = shortName('Plouaret Trégor Lannion Perros-Guirec');
  expect(long.endsWith('…')).toBe(true);
  expect(long.length).toBeLessThanOrEqual(19);
  expect(long).toBe('PLOUARET TRÉGOR…'); // coupé à un espace, pas au milieu d'un mot
});

test('layoutLabels : écart minimal, colonne 1 pour une gare trop proche, première et dernière toujours visibles', () => {
  // Gares à 0, 5, 30, 40, 100, 105 px.
  expect(layoutLabels([0, 5, 30, 40, 100, 105], 14, true)).toEqual([0, 1, 0, 1, 1, 0]); // 100 px, trop près de la dernière : décalée en colonne 1
  expect(layoutLabels([0, 5, 30, 40, 100, 105], 14, false)).toEqual([0, null, 0, null, null, 0]);
  expect(layoutLabels([0], 14, true)).toEqual([0]);
});

test('pickLabels : boîtes englobantes, priorité au surligné puis au plus en retard, aucun chevauchement', () => {
  const kept = pickLabels([
    { key: 'a', x: 0, y: 0, w: 30, h: 10, priority: 1 },
    { key: 'hl', x: 10, y: 4, w: 30, h: 10, priority: 1e9 }, // chevauche a : a disparaît
    { key: 'b', x: 50, y: 0, w: 30, h: 10, priority: 5 },
    { key: 'c', x: 0, y: 30, w: 30, h: 10, priority: 0 },
  ]);
  expect(kept.map((k) => k.key)).toEqual(['hl', 'b', 'c']);
});

test('isForeign : tous les codes UIC hors 87', () => {
  expect(isForeign(['83016071'])).toBe(true);
  expect(isForeign(['87391003'])).toBe(false);
  expect(isForeign([])).toBe(false);
});
