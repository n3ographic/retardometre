import { expect, test } from 'vitest';
import { lastCompleteWeek, lastCompleteWeekId, weekDays, shapeWeek, summaryText, type WeekPayload, type WeekRow } from '../lib/weekly';

const prices = [
  { brand: 'INOUI', price_eur_ht: 50, seats: 500, price_source: '', seats_source: '', as_of: '' },
  { brand: 'OUIGO', price_eur_ht: 30, seats: 600, price_source: '', seats_source: '', as_of: '' },
];
const day = (date: string, circulated: number, ok: number, cause?: string) =>
  ({ date, m: { circulated, on_time_official: ok, ...(cause ? { [`cause:${cause}`]: 5, 'cause:sans_cause': 50 } : {}) } });
const payload = (days: number, circ: Record<string, [number, number]>, extra: WeekPayload['stats'] = []): WeekPayload => ({
  from: '2026-10-26', to: '2026-11-01', monday: '2026-10-26', days, prices, scale: [],
  stats: [...Object.entries(circ).flatMap(([axis, [c, ok]]) => [['INOUI', axis, 'circulated', c], ['INOUI', axis, 'on_time_official', ok], ['INOUI', axis, 'observed', c]] as WeekPayload['stats']), ...extra],
  by_day: [day('2026-10-26', 600, 400, 'obstacle'), day('2026-10-27', 600, 540), day('2026-10-28', 20, 0)],
  train: { number: '9255', counted: 7, ok: 0, delay_sum_s: 15000, brand: 'INOUI', axis: 'SUD_EST', origin: 'Paris', dest: 'Milano', days: [['2026-10-26', true, false, 2700], ['2026-10-27', false, null, null]] },
  heatmap: [[1, 7, 10, 60], [1, 9, 3, 1200]],
});
const row = (week: string, p: WeekPayload): WeekRow => ({ week, monday: p.monday, payload: p, computed_at: '2026-11-02T05:00:00Z' });

test('chiffres clés, variations et mention de la semaine précédente incomplète', () => {
  const cur = row('2026-W44', payload(7, { EST: [100, 90], NORD: [100, 70] }, [['INOUI', 'NORD', 'cause:obstacle', 3], ['INOUI', 'NORD', 'cause_comp:obstacle', 50], ['INOUI', 'EST', 'cause:enchainement', 9], ['INOUI', 'EST', 'cause_comp:enchainement', 25]]));
  const prev = row('2026-W43', payload(6, { EST: [80, 76], NORD: [80, 76] }));
  const w = shapeWeek(cur, prev);
  expect(w.title).toBe('SEMAINE 44 · DU 26/10 AU 01/11');
  // 200 trains en 7 jours contre 160 en 6 : comparés par jour (28,6 contre 26,7), soit +7,1 %.
  expect(w.kpis.trains).toEqual({ value: 200, delta: { value: 7.1, unit: '%', good: true, perDay: true } });
  expect(w.kpis.regularity.value).toBe(80);
  expect(w.kpis.regularity.delta).toEqual({ value: -15, unit: 'PT', good: false });
  expect(w.prev).toMatchObject({ num: 43, incomplete: true, days: 6 });
  expect(w.takeaways[0]).toBe('La régularité perd 15,0 points par rapport à la semaine 43 (incomplète, 6 jours), à 80,0 %.');
  // Pire et meilleur jour : le 28/10 (20 trains) est écarté ; la cause « sans cause » ne compte pas.
  expect(w.worstDay).toMatchObject({ label: 'LUN 26/10', pct: 66.7, cause: 'obstacle' });
  expect(w.bestDay).toMatchObject({ label: 'MAR 27/10', pct: 90 });
  expect([w.bestAxis, w.worstAxis]).toEqual(['EST', 'NORD']);
  // Obstacle : 3 trains, 2e en nombre, mais 1re cause en euros.
  expect(w.causes[0].sentence).toMatch(/^Obstacle, animal, choc : 3 trains seulement \(2e en nombre\), mais première cause en euros/);
  expect(w.heat[0].cells.map((c) => c.n)).toEqual([10, 0, 3]);
  expect(w.train?.days.map((d) => d.state)).toEqual(['ran', 'unobserved']);
});

test('résumé à copier : 5 lignes au plus, chiffres de la page et lien', () => {
  const w = shapeWeek(row('2026-W44', payload(7, { EST: [100, 90], NORD: [100, 70] })), row('2026-W43', payload(6, { EST: [80, 76], NORD: [80, 76] })));
  const lines = summaryText(w, 'https://x/semaine/2026-W44').split('\n');
  expect(lines).toEqual([
    'TGV · semaine 44 (26/10 → 01/11)',
    'Régularité : 80,0 % (−15,0 pt vs S43, incomplète)',
    'Indemnités théoriques : 0 k€ HT · 200 trains',
    'Train de la semaine : 9255 Paris → Milano, à l’heure 0/7 jours',
    'https://x/semaine/2026-W44',
  ]);
});

test('sans semaine précédente : aucune variation', () => {
  const w = shapeWeek(row('2026-W43', payload(6, { EST: [100, 90] })), null);
  expect(w.kpis.trains.delta).toBeNull();
  expect(w.complete).toBe(false);
});

test('dernière semaine complète : le bilan du lundi n’existe qu’après 07:00 UTC au plus tard', () => {
  expect(lastCompleteWeek(new Date('2026-11-02T20:00:00Z'))).toBe(44);
  expect(lastCompleteWeek(new Date('2026-11-09T04:00:00Z'))).toBe(44);
  expect(lastCompleteWeek(new Date('2026-11-09T07:30:00Z'))).toBe(45);
  expect(lastCompleteWeekId(new Date('2026-11-04T12:00:00Z'))).toBe('2026-W44');
  expect(lastCompleteWeekId(new Date('2027-01-12T12:00:00Z'))).toBe('2027-W01'); // année ISO, pas calendaire
  expect(lastCompleteWeek(new Date('2027-01-05T12:00:00Z'))).toBe(53); // 2026 compte 53 semaines ISO
});

test('weekDays : lundi et dimanche de la semaine ISO', () => {
  expect(weekDays('2026-W44')).toEqual(['26/10', '01/11']);
  expect(weekDays('2027-W01')).toEqual(['04/01', '10/01']);
  expect(weekDays('2026-W53')).toEqual(['28/12', '03/01']);
});
