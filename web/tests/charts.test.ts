import { expect, test } from 'vitest';
import { dayCell, lateBars, lateHeadline, onTimeLabel, weekSlots } from '../lib/week-charts';

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
test('trains en retard : 100 moins la régularité, échelle de 0 au pire jour arrondi à 5', () => {
  const b = lateBars(week([66.7, 75.3, 79.2, 82.4, 79.8, 84.9, 82]).map((d) => ({ ...d, small: false })));
  expect(b.slots.map((s) => s?.late)).toEqual([33.3, 24.7, 20.8, 17.6, 20.2, 15.1, 18]);
  expect(b.top).toBe(35);
  expect(b.slots[0]?.height).toBeCloseTo((33.3 / 35) * 100);
  expect(b.worst).toBe('2026-10-26');
});

test('pire jour : un jour de moins de 30 trains ne compte pas ; semaine sans mesure : rien', () => {
  const days = week([90, 50, 80, null, 80, 80, 80]).map((d, i) => ({ ...d, small: i === 1 }));
  const b = lateBars(days);
  expect(b.worst).toBe('2026-10-28');
  expect(b.slots[3]).toBeNull();
  expect(lateBars(week([null, null]).map((d) => ({ ...d, small: false })))).toMatchObject({ worst: null, top: 5 });
});

test('phrase titre : « 1 train sur N », pourcentage à partir de la moitié, aucun retard', () => {
  expect(lateHeadline(33.3)).toBe('1 TRAIN SUR 3 EN RETARD');
  expect(lateHeadline(15.1)).toBe('1 TRAIN SUR 7 EN RETARD');
  expect(lateHeadline(55)).toBe('55,0 % DES TRAINS EN RETARD');
  expect(lateHeadline(0)).toBe('AUCUN TRAIN EN RETARD');
});

// Cases du train de la semaine : jour, date et retard écrits dedans ; ✓ sous le seuil de la régularité du jour.
const cell = (state: 'ran' | 'cancelled' | 'unobserved', delay_s: number | null, max_delay_s = 300) =>
  dayCell({ date: '2026-10-26', label: 'LUN 26/10', state, delay_s, max_delay_s });

test('case du train : à l’heure sous le seuil du trajet (5′, 10′ ou 15′)', () => {
  expect(cell('ran', 299)).toEqual({ top: 'LUN', date: '26/10', text: '✓', cls: 'tp-s0', ok: true });
  expect(cell('ran', 300)).toEqual({ top: 'LUN', date: '26/10', text: '+5′', cls: 'tp-s1', ok: false });
  expect(cell('ran', 600, 900)).toMatchObject({ text: '✓', ok: true }); // trajet de plus de 3 h : 10′ est à l'heure
  expect(cell('ran', 900, 900)).toMatchObject({ text: '+15′', ok: false });
  expect(cell('ran', 2700)).toMatchObject({ text: '+45′', ok: false });
});

test('légende du seuil : un seul seuil, ou ceux de la semaine', () => {
  expect(onTimeLabel([{ max_delay_s: 900 }, { max_delay_s: 900 }])).toBe('MOINS DE 15′');
  expect(onTimeLabel([{ max_delay_s: 900 }, { max_delay_s: 600 }])).toBe('MOINS DE 10′ OU 15′ SELON LE JOUR');
});

test('case du train : retard non mesuré, supprimé, non observé', () => {
  expect(cell('ran', null)).toMatchObject({ text: '–', cls: 'tp-unobs', ok: false });
  expect(cell('cancelled', null)).toMatchObject({ text: '×', cls: 'tp-cancel', ok: false });
  expect(cell('unobserved', null)).toMatchObject({ text: '', cls: 'tp-unobs', ok: false });
});
