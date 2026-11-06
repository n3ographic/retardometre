import { expect, test } from 'vitest';
import { curvePoints } from '../lib/week-charts';

const SIZE = { width: 700, height: 200, pad: 20 };
// Jours du lundi 26/10 au dimanche 01/11 avec leur régularité ; null = aucune mesure.
const week = (pcts: (number | null)[], from = 26) =>
  pcts.map((pct, i) => ({ date: from + i <= 31 ? `2026-10-${from + i}` : `2026-11-0${from + i - 31}`, pct, small: false }));

test('semaine complète : 7 emplacements, axe arrondi à 5 points', () => {
  const c = curvePoints(week([70, 80, 90, 85, 75, 80, 66.7]), SIZE);
  expect([c.yMin, c.yMax]).toEqual([65, 90]);
  expect(c.points[0]?.x).toBe(20);
  expect(c.points[6]?.x).toBe(680);
  expect(c.yOf(90)).toBe(20);
  expect(c.yOf(65)).toBe(180);
  expect(c.runs).toEqual([[0, 1, 2, 3, 4, 5, 6]]);
});

test('semaine qui commence un mardi : le lundi est un trou, les jours restent à leur place', () => {
  const c = curvePoints(week([70, 80, 90, 85, 75, 80], 20), SIZE);
  expect(c.points[0]).toBeNull();
  expect(c.points[1]?.x).toBeCloseTo(20 + 660 / 6);
  expect(c.runs).toEqual([[1, 2, 3, 4, 5, 6]]);
});

test('jour sans mesure au milieu : la courbe est coupée', () => {
  expect(curvePoints(week([70, 80, null, 85, 75, 80, 70]), SIZE).runs).toEqual([[0, 1], [3, 4, 5, 6]]);
});

test('jour de moins de 30 trains : point en creux', () => {
  const days = week([70, 80, 90, 85, 75, 80, 70]);
  days[3].small = true;
  expect(curvePoints(days, SIZE).points[3]?.hollow).toBe(true);
  expect(curvePoints(days, SIZE).points[2]?.hollow).toBe(false);
});

test('régularité identique tous les jours : l’axe ne s’écrase pas', () => {
  const c = curvePoints(week([80, 80, 80, 80, 80, 80, 80]), SIZE);
  expect([c.yMin, c.yMax]).toEqual([75, 80]);
});

test('aucune mesure : aucun point, axe de 0 à 100', () => {
  const c = curvePoints(week([null, null, null, null, null, null, null]), SIZE);
  expect(c.points.every((p) => p === null)).toBe(true);
  expect(c.runs).toEqual([]);
  expect([c.yMin, c.yMax]).toEqual([0, 100]);
});
