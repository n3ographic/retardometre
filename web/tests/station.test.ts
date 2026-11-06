import { expect, test, vi } from 'vitest';
import { createStationHandler } from '../lib/handlers';
import { boardLines, boardTitle, knownArea, parseGares, readBoard, regPct, shapeBoard, stationName, type BoardRow } from '../lib/station';

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

const stopRows = [
  { stop_id: 'StopArea:OCE87773002', name: 'Montpellier Saint-Roch', lat: 43.6, lon: 3.88 },
  { stop_id: 'StopArea:OCE87688887', name: 'Montpellier Sud de France', lat: 43.59, lon: 3.92 },
  { stop_id: 'StopArea:OCE87581009', name: 'Bordeaux Saint-Jean', lat: 44.8, lon: -0.55 },
];

test('knownArea : codes connus et voisins ; code inventé ou villes éloignées refusés', () => {
  const g: [string, string, number?, number?][] = [['87773002', 'Montpellier Saint-Roch', 43.6, 3.88], ['87688887', 'Montpellier Sud de France', 43.59, 3.92],
    ['87581009', 'Bordeaux Saint-Jean', 44.8, -0.55], ['87000001', 'Lyon Part-Dieu'], ['87000002', 'Lyon Perrache'], ['87000003', 'Nice Ville']];
  expect(knownArea(['87773002'], g)).toBe(true);
  expect(knownArea(['87773002', '87688887'], g)).toBe(true); // ~3,5 km
  expect(knownArea(['87773002', '87581009'], g)).toBe(false); // Montpellier + Bordeaux
  expect(knownArea(['87773002', '12345678'], g)).toBe(false); // code inventé
  expect(knownArea(['87000001', '87000002'], g)).toBe(true); // sans coordonnées : même ville
  expect(knownArea(['87000001', '87000003'], g)).toBe(false);
});

test('handler : 400 sans code valide ; 404 sans lecture si gare inconnue ou villes mêlées ; un appel par jeu de gares trié et par cycle', async () => {
  const rpc = vi.fn(async () => ({ data: raw([row({})]), error: null }));
  const keys: string[] = [];
  const select = vi.fn(async () => ({ data: stopRows, error: null }));
  const deps = { rpc, select, now: () => new Date('2026-11-02T17:00:00Z'), cached: <T>(k: string[], _s: number, fn: () => Promise<T>) => { keys.push(k.join('|')); return fn(); } };
  expect((await createStationHandler(deps)(new Request('http://x/api/gare?uic=abc'))).status).toBe(400);
  for (const q of ['12345678', '87773002,87581009']) {
    const r = await createStationHandler(deps)(new Request(`http://x/api/gare?uic=${q}`));
    expect(r.status).toBe(404);
    expect(r.headers.get('cache-control')).toBe('no-store');
  }
  expect(rpc).not.toHaveBeenCalled();
  const r = await createStationHandler(deps)(new Request('http://x/api/gare?uic=87773002,87688887'));
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(readBoard(body).gares[0].nom).toBe('Bordeaux Saint-Jean'); // le navigateur relit la réponse telle quelle
  expect(() => readBoard({ rows: [] })).toThrow();
  expect(rpc).toHaveBeenCalledWith('station_board', { p_uics: ['87773002', '87688887'] });
  expect(keys.filter((k) => k.startsWith('gare|'))[0]).toMatch(/^gare\|v1\|87688887,87773002\|\d+$/);
});

test('nom de gare affiché : sans « Hall 1 - 2 », casse normale pour les noms en capitales', () => {
  expect(stationName('Paris Gare de Lyon Hall 1 - 2')).toBe('Paris Gare de Lyon');
  expect(stationName('MILANO PORTA GARIBALDI')).toBe('Milano Porta Garibaldi');
  expect(stationName('FIGUERES-VILAFANT')).toBe('Figueres-Vilafant');
  expect(stationName('Saint-Jean-de-Luz - Ciboure')).toBe('Saint-Jean-de-Luz - Ciboure');
});
