import { expect, test } from 'vitest';
import { dayCell, weekSlots } from '../lib/week-charts';

// Jours du lundi 26/10 au dimanche 01/11 avec leur régularité ; null = aucune mesure.
const week = (pcts: (number | null)[], from = 26) =>
  pcts.map((pct, i) => ({ date: from + i <= 31 ? `2026-10-${from + i}` : `2026-11-0${from + i - 31}`, pct }));

test('barres : 7 colonnes du lundi au dimanche', () => {
  const s = weekSlots(week([50, 80, 90, 85, 75, 100, 66.7]));
  expect(s).toHaveLength(7);
  expect(s.map((d) => d?.pct)).toEqual([50, 80, 90, 85, 75, 100, 66.7]);
});

test('semaine qui commence un mardi : le lundi est vide, les jours restent à leur place', () => {
  const s = weekSlots(week([70, 80, 90, 85, 75, 80], 20));
  expect(s[0]).toBeNull();
  expect(s[1]?.date).toBe('2026-10-20');
  expect(s[6]?.date).toBe('2026-10-25');
});
// Cases du train de la semaine : jour, date et retard écrits dedans ; ✓ seulement sous 5′.
const cell = (state: 'ran' | 'cancelled' | 'unobserved', delay_s: number | null) => dayCell({ date: '2026-10-26', label: 'LUN 26/10', state, delay_s });

test('case du train : à l’heure sous 5′ seulement', () => {
  expect(cell('ran', 299)).toEqual({ top: 'LUN', date: '26/10', text: '✓', cls: 'tp-s0', ok: true });
  expect(cell('ran', 300)).toEqual({ top: 'LUN', date: '26/10', text: '+5′', cls: 'tp-s1', ok: false });
  expect(cell('ran', 2700)).toMatchObject({ text: '+45′', ok: false });
});

test('case du train : retard non mesuré, supprimé, non observé', () => {
  expect(cell('ran', null)).toMatchObject({ text: '–', cls: 'tp-unobs', ok: false });
  expect(cell('cancelled', null)).toMatchObject({ text: '×', cls: 'tp-cancel', ok: false });
  expect(cell('unobserved', null)).toMatchObject({ text: '', cls: 'tp-unobs', ok: false });
});
