import { expect, test } from 'vitest';
import { shapeProfile, todayLabel, type RawProfile } from '../lib/train-profile';
import { prices } from './fixtures';

const info = { brand: 'INOUI', axis: 'ATLANTIQUE', origin: 'Paris', dest: 'Hendaye', dep_planned: '2026-11-02T09:11:00Z', arr_planned: '2026-11-02T13:48:00Z' };
const raw = (over: Partial<RawProfile> = {}): RawProfile => ({
  info, today: null, stops: [['87391003', 'Paris', 692, 13], ['87677005', null, null, 0]],
  days: [
    ['2026-10-20', false, false, null, null, 0], // non observé : hors score
    ['2026-10-21', true, false, 0, 'sans_cause', 0],
    ['2026-10-22', true, false, 240, 'sans_cause', 0], // 4 min : à l'heure
    ['2026-10-23', true, false, 2400, 'materiel', 25],
    ['2026-10-24', true, true, null, null, 0], // supprimé : compte comme un échec
    ['2026-10-25', true, false, null, null, 0], // retard illisible (≥ 12 h) : écarté
    ['2026-10-26', true, false, 600, 'materiel', 0],
  ],
  axis: [['8537', 5, 2], ['1', 10, 9], ['2', 10, 1], ['3', 4, 0], ['4', 0, 0]],
  ...over,
});

test('score : à l’heure < 5 min, suppression = échec, non observé et illisible écartés ; moyenne, médiane, échantillon faible', () => {
  const p = shapeProfile('8537', raw(), prices);
  expect(p.score).toEqual({ ok: 2, n: 5, small: true, mean_min: 13.5, median_min: 7 }); // retards 0, 240, 2400, 600 s
  expect(p.days.map((d) => d.state)).toEqual(['unobserved', 'ran', 'ran', 'ran', 'cancelled', 'ran', 'ran']);
});

test('causes des retards ≥ 5 min, indemnités au barème de la marque, rang dans l’axe, gares', () => {
  const p = shapeProfile('8537', raw(), prices);
  expect(p.causes).toEqual([{ category: 'materiel', days: 2 }]);
  expect(p.comp).toEqual({ days: 1, eur: Math.round(0.25 * 46.6 * 556 * 0.75) });
  expect(p.rank).toEqual({ better_than_pct: 67, of: 3 }); // 2/5 = 40 % bat 10 % et 0 %, pas 90 % ; le train à 0 jour ignoré
  expect(p.stops).toEqual([{ uic: '87391003', nom: 'Paris', avg_min: 11.5, n: 13 }, { uic: '87677005', nom: '87677005', avg_min: null, n: 0 }]);
  expect(shapeProfile('8537', raw({ axis: [['8537', 5, 2]] }), prices).rank).toBeNull();
});

test('todayLabel : non prévu, supprimé, pas encore parti, en route, arrivé', () => {
  const at = (iso: string) => new Date(iso);
  const t = (over = {}) => ({ info, today: { date: '2026-11-02', observed: true, cancelled: false, delay_s: 3000, last_seen_at: null, ...over } });
  expect(todayLabel({ info, today: null }, at('2026-11-02T10:00:00Z')).text).toBe('PAS PRÉVU AUJOURD’HUI');
  expect(todayLabel(t({ cancelled: true }), at('2026-11-02T10:00:00Z')).text).toBe('SUPPRIMÉ AUJOURD’HUI');
  expect(todayLabel(t(), at('2026-11-02T09:00:00Z')).text).toBe('PAS ENCORE PARTI');
  expect(todayLabel(t(), at('2026-11-02T14:00:00Z')).text).toBe('EN ROUTE · +50′'); // 13:48 + 50 min
  expect(todayLabel(t({ delay_s: 0 }), at('2026-11-02T14:00:00Z')).text).toBe('ARRIVÉ · À L’HEURE');
});
