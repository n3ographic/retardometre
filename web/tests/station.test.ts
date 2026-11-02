import { expect, test, vi } from 'vitest';
import { createStationHandler } from '../lib/handlers';
import { boardLines, boardTitle, parseGares, readBoard, regPct, shapeBoard, type BoardRow } from '../lib/station';

const row = (o: Partial<BoardRow>): BoardRow => ({
  trip_id: 't', train_number: '8537', brand: 'INOUI', axis: 'ATLANTIQUE', uic: '87581009', cancelled: false, first: false, last: false,
  origin: 'Paris', dest: 'Hendaye', arr: '2026-11-02T17:00:00Z', dep: '2026-11-02T17:05:00Z', ...o,
});
const raw = (rows: BoardRow[], gares: [string, string, number, number][] = [['87581009', 'Bordeaux Saint-Jean', 44.8, -0.55]]) =>
  ({ gares, today_trains: 77, reg: { n: 468, ok: 356 }, rows });

test('parseGares : 8 chiffres, sans doublon, 8 au plus ; rien de valide = null', () => {
  expect(parseGares('87773002,87688887')).toEqual(['87773002', '87688887']);
  expect(parseGares('87773002,x,87773002,123')).toEqual(['87773002']);
  expect(parseGares(Array.from({ length: 10 }, (_, i) => `8700000${i}`).join(','))).toHaveLength(8);
  expect(parseGares('abc')).toBeNull();
  expect(parseGares(null)).toBeNull();
});

test('shapeBoard et titre : gare seule, ville regroupée ; réponse illisible = erreur', () => {
  expect(boardTitle(shapeBoard(raw([])))).toBe('BORDEAUX SAINT-JEAN');
  expect(boardTitle(shapeBoard(raw([], [['87773002', 'Montpellier Saint-Roch', 43.6, 3.88], ['87688887', 'Montpellier Sud de France', 43.59, 3.92]])))).toBe('MONTPELLIER');
  expect(regPct(shapeBoard(raw([])))).toBe(76.1);
  expect(() => shapeBoard({ rows: [] })).toThrow();
  expect(() => shapeBoard(null)).toThrow();
});

test('boardLines : départs sans terminus, arrivées sans origine, heure estimée, passés repérés, tri par heure', () => {
  const b = shapeBoard(raw([
    row({ trip_id: 'a', train_number: '8537', delay_s: 600 }), // passage : départ 18:05 → 18:15
    row({ trip_id: 'b', train_number: '8485', last: true, arr: '2026-11-02T16:40:00Z', dep: '2026-11-02T16:40:00Z' }), // terminus
    row({ trip_id: 'c', train_number: '8400', first: true, arr: undefined, dep: '2026-11-02T16:50:00Z', delay_s: -60 }), // origine
  ]));
  const now = new Date('2026-11-02T17:00:00Z');
  const dep = boardLines(b, 'DEP', now);
  expect(dep.map((l) => [l.train_number, l.planned, l.estimated, l.past, l.place])).toEqual([
    ['8400', '17:50', '17:50', true, 'Hendaye'], // avance ignorée
    ['8537', '18:05', '18:15', false, 'Hendaye'],
  ]);
  expect(boardLines(b, 'ARR', now).map((l) => [l.train_number, l.planned, l.place])).toEqual([['8485', '17:40', 'Paris'], ['8537', '18:00', 'Paris']]);
});

test('handler : 400 sans code valide ; un appel par jeu de gares trié et par cycle', async () => {
  const rpc = vi.fn(async () => ({ data: raw([row({})]), error: null }));
  const keys: string[] = [];
  const deps = { rpc, select: vi.fn(), now: () => new Date('2026-11-02T17:00:00Z'), cached: <T>(k: string[], _s: number, fn: () => Promise<T>) => { keys.push(k.join('|')); return fn(); } };
  expect((await createStationHandler(deps)(new Request('http://x/api/gare?uic=abc'))).status).toBe(400);
  const r = await createStationHandler(deps)(new Request('http://x/api/gare?uic=87773002,87688887'));
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(readBoard(body).gares[0].nom).toBe('Bordeaux Saint-Jean'); // le navigateur relit la réponse telle quelle
  expect(() => readBoard({ rows: [] })).toThrow();
  expect(rpc).toHaveBeenCalledWith('station_board', { p_uics: ['87773002', '87688887'] });
  expect(keys[0]).toMatch(/^gare\|v1\|87688887,87773002\|\d+$/);
});
