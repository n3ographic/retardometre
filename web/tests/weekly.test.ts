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
  // S43 incomplète (6 jours) : aucune variation, ni sur la page ni dans « À retenir » ; jamais de variation du nombre de trains.
  expect(w.kpis.trains).toEqual({ value: 200 });
  expect(w.kpis.regularity.value).toBe(80);
  expect([w.kpis.regularity.delta, w.kpis.cost.delta, w.kpis.suppressions.delta]).toEqual([null, null, null]);
  expect(w.prev).toMatchObject({ num: 43, incomplete: true, days: 6 });
  // Deux semaines complètes : variations affichées.
  const full = shapeWeek(cur, row('2026-W43', payload(7, { EST: [80, 76], NORD: [80, 76] })));
  expect(full.kpis.regularity.delta).toEqual({ value: -15, unit: 'PT', good: false });
  // Meilleur jour : le 28/10 (20 trains) est écarté et marqué faible ; la cause « sans cause » ne compte pas.
  expect(w.bestDay).toMatchObject({ label: 'MAR 27/10', pct: 90 });
  expect(w.byDay.map((d) => d.small)).toEqual([false, false, true]);
  // Créneau le plus touché : la case de 9 h (20′) n'a que 3 trains, celle de 7 h (10 trains, 1′) l'emporte.
  expect(w.worstSlot).toEqual({ dow: 1, hour: 7, n: 10, avg_min: 1, label: 'LUN 26/10', date: '2026-10-26' });
  expect([w.bestAxis, w.worstAxis]).toEqual(['EST', 'NORD']);
  // Obstacle : 3 trains, 2e en nombre, 1re en euros ; un seul rang d'écart, phrase neutre sans le rang.
  expect(w.causes.map((c) => [c.category, c.euroRank, c.trainRank])).toEqual([['obstacle', 1, 2], ['enchainement', 2, 1]]);
  expect(w.causes[0].sentence).toMatch(/^\d+′ de retard moyen, \d+ % des indemnités/);
  expect(w.axes.map((a) => [a.axis, a.circulated, a.per_train])).toEqual([['EST', 100, 0], ['NORD', 100, 0]]);
  expect(w.heat[0].cells.map((c) => c.n)).toEqual([10, 0, 3]);
  expect(w.train?.days.map((d) => d.state)).toEqual(['ran', 'unobserved']);
  // Bilan figé sans seuil du jour : 5′, la règle de l'époque.
  expect(w.train?.days.map((d) => d.max_delay_s)).toEqual([300, 300]);
});

test('train de la semaine : seuil du jour repris du bilan', () => {
  const p = payload(7, { EST: [100, 90] });
  const w = shapeWeek(row('2026-W44', { ...p, train: { ...p.train!, days: [['2026-10-26', true, false, 600, 900]] } }), null);
  expect(w.train?.days[0]).toMatchObject({ delay_s: 600, max_delay_s: 900 });
});

test('résumé à copier : 5 lignes au plus, chiffres de la page et lien', () => {
  const w = shapeWeek(row('2026-W44', payload(7, { EST: [100, 90], NORD: [100, 70] })), row('2026-W43', payload(7, { EST: [80, 76], NORD: [80, 76] })));
  const lines = summaryText(w, 'https://x/semaine/2026-W44').split('\n');
  expect(lines).toEqual([
    'TGV · semaine 44 (26/10 → 01/11)',
    'Régularité : 80,0 % (−15,0 pt vs S43)',
    'Indemnités théoriques : 0 k€ HT · 200 trains',
    'Train de la semaine : 9255 Paris → Milano, à l’heure 0/7 jours',
    'https://x/semaine/2026-W44',
  ]);
});

test('résumé à copier : régularité absente notée « n.d. », sans tiret cadratin', () => {
  const w = shapeWeek(row('2026-W44', { ...payload(7, {}), train: null }), null);
  expect(w.kpis.regularity.value).toBeNull();
  const text = summaryText(w, 'https://x');
  expect(text).toContain('Régularité : n.d.');
  expect(text).not.toContain('—');
});

test('sans semaine précédente : aucune variation', () => {
  const w = shapeWeek(row('2026-W43', payload(6, { EST: [100, 90] })), null);
  expect(w.kpis.regularity.delta).toBeNull();
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

test('causes : phrase selon l’écart de rang ; indemnité par train ; part en bons', () => {
  const c = (cat: string, trains: number, comp: number): WeekPayload['stats'] =>
    [['INOUI', 'NORD', `cause:${cat}`, trains], ['INOUI', 'NORD', `cause_delay_s:${cat}`, trains * 600], ['INOUI', 'NORD', `cause_comp:${cat}`, comp]];
  const w = shapeWeek(row('2026-W44', payload(7, { NORD: [100, 70] }, [
    ...c('obstacle', 2, 300), ...c('infra', 5, 200), ...c('enchainement', 9, 50),
    ['INOUI', 'NORD', 'comp_pct_sum', 100], ['INOUI', 'NORD', 'comp_pct_sum_bon', 90],
  ])), null);
  // En euros : obstacle, infra, enchaînement ; en nombre : enchaînement, infra, obstacle.
  expect(w.causes.map((x) => [x.euroRank, x.trainRank])).toEqual([[1, 3], [2, 2], [3, 1]]);
  // Le rang et le nombre de trains sont sur la ligne du dessus : la phrase ne les répète pas, sans « seulement ».
  expect(w.causes[0].sentence).toBe('Retards longs : 10′ en moyenne, 55 % des indemnités liées à une cause.');
  expect(w.causes[1].sentence).toBe('10′ de retard moyen, 36 % des indemnités liées à une cause.');
  expect(w.causes[2].sentence).toBe('Retards plus courts : 10′ en moyenne, 9 % des indemnités liées à une cause.');
  expect(w.causes.map((x) => x.sentence).join(' ')).not.toMatch(/seulement|en nombre/);
  // 100 % × 50 € × 500 places × 0,75 = 18 750 € pour 100 trains.
  expect(w.axes[0].per_train).toBe(188);
  expect(w.kpis.cost.bonShare).toBe(90);
});

test('bilan sans part en bons ni grille : pas de part ni de créneau', () => {
  const w = shapeWeek(row('2026-W44', { ...payload(7, { EST: [100, 90] }), heatmap: null }), null);
  expect(w.kpis.cost.bonShare).toBeNull();
  expect(w.worstSlot).toBeNull();
});

test('grille : heures de nuit vides masquées, trous de journée gardés', () => {
  const p = { ...payload(7, { EST: [100, 90] }), heatmap: [[1, 0, 2, 60], [1, 5, 1, 0], [2, 7, 10, 60], [3, 10, 4, 120]] as WeekPayload['heatmap'] };
  expect(shapeWeek(row('2026-W44', p), null).heat[0].cells.map((c) => c.hour)).toEqual([0, 5, 7, 8, 9, 10]);
});

test('weekDays : lundi et dimanche de la semaine ISO', () => {
  expect(weekDays('2026-W44')).toEqual(['26/10', '01/11']);
  expect(weekDays('2027-W01')).toEqual(['04/01', '10/01']);
  expect(weekDays('2026-W53')).toEqual(['28/12', '03/01']);
});
