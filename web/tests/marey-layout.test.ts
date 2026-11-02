import { expect, test } from 'vitest';
import { isForeign, pickLabels, shortName, spreadLabels } from '../lib/marey-layout';

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

test('spreadLabels : au plus près, écartées d\'au moins gap, groupe centré, bornes respectées, tassées si trop nombreuses', () => {
  expect(spreadLabels([0, 50, 100], 14, 0, 100)).toEqual([0, 50, 100]); // rien à déplacer
  expect(spreadLabels([40, 44], 14, 0, 100)).toEqual([35, 49]); // groupe centré sur 42
  expect(spreadLabels([0, 2], 14, 0, 100)).toEqual([0, 14]); // borné en haut
  expect(spreadLabels([98, 100], 14, 0, 100)).toEqual([86, 100]); // borné en bas
  expect(spreadLabels([30, 40, 45, 55], 14, 0, 200)).toEqual([21.5, 35.5, 49.5, 63.5]); // fusion en chaîne
  expect(spreadLabels([0, 1, 2, 3], 14, 0, 30)).toEqual([0, 10, 20, 30]); // pas la place : pas réduit à 10
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
