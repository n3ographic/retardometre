import { beforeEach, expect, test, vi } from 'vitest';
import { createMareyHandler, createMareyIndexHandler } from '../lib/handlers';
import {
  matchLines, fetchWindow, findTrain, hourTicks, parseApiParams, parseMareyParams, plannedPoints, publishedDelayAt, shapeMarey, trainTrace,
  type AxesFile, type RawStop, type RawTrain,
} from '../lib/marey';
import { prices } from './fixtures';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

const P = { nom: 'Paris', km: 0, stop_ids: ['P'] }, LM = { nom: 'Le Mans', km: 200, stop_ids: ['LM'] };
const axes: AxesFile = {
  branches: [
    { id: 'pdl', label: 'Pays de la Loire', lignes: [
      { id: 'croisic', label: 'Le Croisic', gares: [P, LM, { nom: 'Nantes', km: 385, stop_ids: ['N'] }, { nom: 'Le Croisic', km: 474, stop_ids: ['C'] }] },
      { id: 'sables', label: 'Les Sables', gares: [P, LM, { nom: 'Nantes', km: 385, stop_ids: ['N'] }, { nom: 'Les Sables', km: 497, stop_ids: ['S'] }] },
    ] },
    { id: 'bz', label: 'Bretagne', lignes: [{ id: 'rennes', label: 'Rennes', gares: [P, LM, { nom: 'Rennes', km: 360, stop_ids: ['R'] }] }] },
  ],
};
const bz = axes.branches[1].lignes[0], croisic = axes.branches[0].lignes[0];
const stop = (code: string, arr: number, dep: number, delay: number | null = null, cancelled = false): RawStop => [code, arr, dep, delay, cancelled];
const train = (number: string, stops: RawStop[], over: Partial<RawTrain> = {}): RawTrain =>
  ({ service_date: '2026-11-02', brand: 'INOUI', train_number: number, cancelled: false, comp_pct: 0, stops, ...over });

test('matchLines : toutes les lignes qui contiennent tous les arrêts connus ; jamais une ligne qui en manque un', () => {
  expect(matchLines(train('1', [stop('P', 0, 0), stop('LM', 1, 1), stop('R', 2, 2)]), axes)).toEqual([{ branch: 'bz', line: 'rennes' }]);
  expect(matchLines(train('2', [stop('P', 0, 0), stop('N', 2, 2), stop('C', 3, 3)]), axes)).toEqual([{ branch: 'pdl', line: 'croisic' }]);
  expect(matchLines(train('3', [stop('P', 0, 0), stop('N', 2, 2)]), axes).map((m) => m.line)).toEqual(['croisic', 'sables']);
  expect(matchLines(train('4', [stop('P', 0, 0), stop('LM', 1, 1)]), axes).map((m) => m.line)).toEqual(['croisic', 'sables', 'rennes']);
  expect(matchLines(train('5', [stop('P', 0, 0), stop('X', 1, 1)]), axes)).toEqual([]); // un seul arrêt connu
  expect(matchLines(train('6', [stop('P', 0, 0), stop('N', 1, 1), stop('R', 2, 2)]), axes)).toEqual([]); // aucune ligne n'a les trois
});

test('plannedPoints : arrivée et départ de chaque arrêt de la ligne, arrêt supprimé ou hors ligne ignoré', () => {
  const t = train('1', [stop('P', 1000, 1000), stop('LM', 2000, 2060), stop('X', 2500, 2500), stop('R', 3000, 3000), stop('N', 3500, 3500, null, true)]);
  expect(plannedPoints(t, bz).map((p) => [p.t, p.km])).toEqual([[1000, 0], [1000, 0], [2000, 200], [2060, 200], [3000, 360], [3000, 360]]);
});

// P (km 0, départ 0) → LM (km 200, arrivée 10 000, départ 10 060) → R (km 360, arrivée 20 000).
const seqStop = (code: string, arr: number, dep: number, seq: number, delay: number | null = null): RawStop => [code, arr, dep, delay, false, seq];
const run = (hist: [number, number, number][]) => train('8537', [seqStop('P', 0, 0, 0), seqStop('LM', 10_000, 10_060, 1), seqStop('R', 20_000, 20_000, 2)], { hist });

test('publishedDelayAt : retard de la prochaine gare à cet instant ; 0 avant toute collecte ; sans historique, dernier retard publié', () => {
  const t = run([[100, 0, 600], [100, 1, 600], [100, 2, 600], [12_000, 2, 1200]]);
  expect(publishedDelayAt(t, 50)).toBe(0);
  expect(publishedDelayAt(t, 5000)).toBe(600); // prochaine gare : Le Mans
  expect(publishedDelayAt(t, 11_000)).toBe(600); // Le Mans quitté à 10 660 : prochaine gare Rennes, encore +600 à 11 000
  expect(publishedDelayAt(t, 12_000)).toBe(1200);
  const sans = train('1', [seqStop('P', 0, 0, 0, 300), seqStop('R', 1000, 1000, 1, 900)]);
  expect(publishedDelayAt(sans, 200)).toBe(300); // Paris pas encore quitté (départ 0 + 300)
  expect(publishedDelayAt(sans, 500)).toBe(900); // Paris quitté : prochaine gare Rennes
});

test('trainTrace : une hausse du retard devient un palier, puis le train repart ; couleur par tranche ; futur après maintenant', () => {
  const t = run([[0, 0, 600], [0, 1, 600], [0, 2, 600], [12_000, 2, 1800]]);
  const tr = trainTrace(t, bz, 0, 30_000, 15_000, 60);
  const kmAtT = (T: number) => tr.actual.find((p) => p.t === T)!.km;
  // Avant la hausse : position de l'horaire 600 s plus tôt.
  expect(kmAtT(5_400)).toBeCloseTo(((5_400 - 600) / 10_000) * 200);
  // Hausse de 600 → 1 800 s à 12 000 : le train reste au même endroit jusqu'à 12 000 − 600 + 1 800 = 13 200…
  expect(kmAtT(12_000)).toBeCloseTo(kmAtT(11_940));
  expect(kmAtT(13_140)).toBeCloseTo(kmAtT(11_940));
  // …puis repart à la vitesse prévue.
  expect(kmAtT(13_800)).toBeGreaterThan(kmAtT(13_140));
  // Deux tranches (5-14 puis 30-59 min), et la partie après maintenant est marquée future.
  expect(tr.runs.map((r) => [r.delay, r.future])).toEqual([[600, false], [1800, false], [1800, true]]);
  expect(tr.runs[1].points[0]).toEqual(tr.runs[0].points[tr.runs[0].points.length - 1]); // morceaux jointifs
  // Arrivée à Rennes à 20 000 + 1 800 : rien après.
  expect(Math.max(...tr.actual.map((p) => p.t))).toBe(21_800);
});

test('findTrain : le bon numéro dans la fenêtre ±3 h, sinon null (jamais un autre train)', () => {
  const hier = train('8537', [stop('P', 100, 100), stop('R', 200, 200)]);
  const ajd = train('8537', [stop('P', 90_100, 90_100), stop('R', 90_200, 90_200)]);
  const autre = train('8921', [stop('P', 90_100, 90_100), stop('N', 90_200, 90_200)]);
  expect(findTrain([autre, hier, ajd], '8537', 90_150)).toBe(ajd);
  expect(findTrain([hier, ajd], '8537', 300)).toBe(hier);
  expect(findTrain([autre, hier], '9999', 150)).toBeNull();
  // Arrivé depuis plus de 3 h : introuvable…
  expect(findTrain([hier], '8537', 200 + 3 * 3600 + 1)).toBeNull();
  // …sauf si son retard le fait encore rouler dans la fenêtre.
  expect(findTrain([train('8537', [stop('P', 100, 100), stop('R', 200, 200, 3600)])], '8537', 200 + 3 * 3600 + 1)).not.toBeNull();
});

test('parseMareyParams et parseApiParams : valeurs par défaut, axe et numéro validés, paramètre inconnu refusé', () => {
  expect(parseMareyParams(new URLSearchParams('axe=atlantique&train=8537'))).toEqual({ axe: 'ATLANTIQUE', train: '8537' });
  expect(parseMareyParams(new URLSearchParams('axe=est&train=abc'))).toEqual({ axe: 'EST', train: null });
  expect(parseMareyParams(new URLSearchParams('axe=OUEST'))).toEqual({ axe: 'ATLANTIQUE', train: null });
  expect(parseApiParams(new URLSearchParams(''))).toEqual({ ok: true, axe: 'ATLANTIQUE' });
  expect(parseApiParams(new URLSearchParams('axe=EST'))).toEqual({ ok: true, axe: 'EST' });
  expect(parseApiParams(new URLSearchParams('axe=OUEST')).ok).toBe(false);
  expect(parseApiParams(new URLSearchParams('train=1')).ok).toBe(false);
});

test('hourTicks : chaque heure pleine de la fenêtre', () => {
  expect(hourTicks(3601, 3600 * 4)).toEqual([7200, 10800, 14400]);
});

test('fetchWindow : seau de 10 min, marge d\'une heure de chaque côté de la fenêtre de 6 h', () => {
  const w = fetchWindow(new Date('2026-11-02T10:07:30Z'));
  expect(w.from).toBe('2026-11-02T06:00:00.000Z');
  expect(w.to).toBe('2026-11-02T14:00:00.000Z');
});

test('shapeMarey : indemnité de référence par voyageur ; marque sans prix = erreur', () => {
  const stops = [{ stop_id: 'StopPoint:OCETGV INOUI-87391003', name: 'Paris Montparnasse', lat: 48.84, lon: 2.32 }, { stop_id: 'X-87000000', name: 'Sans coord', lat: null, lon: null }];
  const s = shapeMarey('ATLANTIQUE', [train('1', [stop('87391003', 0, 0), stop('87000000', 1, 1)], { comp_pct: 50 })], prices, stops, new Date('2026-11-02T10:00:00Z'));
  expect(s.trains[0].comp_eur_per_passenger_ref).toBe(23.3);
  expect(s.gares).toEqual({ '87391003': { nom: 'Paris Montparnasse', lat: 48.84, lon: 2.32 } }); // gare sans coordonnées omise
  expect(() => shapeMarey('ATLANTIQUE', [train('1', [], { brand: 'XX' })], prices, [], new Date())).toThrow('prix de référence');
});

const now = () => new Date('2026-11-02T10:07:30Z');
const deps = () => ({
  rpc: vi.fn(async () => ({ data: [train('1', [stop('P', 0, 0)], { comp_pct: 25 })], error: null })),
  select: vi.fn(async (table: string) => ({ data: table === 'stops' ? [] : prices, error: null })),
  now,
  cached: <T>(_k: string[], _s: number, fn: () => Promise<T>) => fn(),
});

test('handler : 200 avec cache court et fenêtre alignée ; 400 sur axe ou paramètre inconnu ; 502 si la base échoue', async () => {
  const d = deps();
  const r = await createMareyHandler(d)(new Request('http://x/api/marey?axe=ATLANTIQUE'));
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=60');
  expect((await r.json()).trains[0].comp_eur_per_passenger_ref).toBe(11.65);
  expect(d.rpc).toHaveBeenCalledWith('marey_trains', { p_axis: 'ATLANTIQUE', p_from: '2026-11-02T06:00:00.000Z', p_to: '2026-11-02T14:00:00.000Z' });
  expect((await createMareyHandler(deps())(new Request('http://x/api/marey?axe=OUEST'))).status).toBe(400);
  expect((await createMareyHandler(deps())(new Request('http://x/api/marey?x=1'))).status).toBe(400);
  const bad = { ...deps(), rpc: vi.fn(async () => ({ data: null, error: { message: 'timeout' } })) };
  const e = await createMareyHandler(bad as never)(new Request('http://x/api/marey'));
  expect(e.status).toBe(502);
  expect(e.headers.get('cache-control')).toBe('no-store');
});

test('index : fenêtre affichée ±3 h autour du seau, aucun paramètre accepté', async () => {
  const d = { ...deps(), rpc: vi.fn(async () => ({ data: [['ATLANTIQUE', '8537', 'Paris', 'Hendaye', 2400]], error: null })) };
  const r = await createMareyIndexHandler(d)(new Request('http://x/api/marey/index'));
  expect(r.status).toBe(200);
  expect((await r.json()).trains).toEqual([['ATLANTIQUE', '8537', 'Paris', 'Hendaye', 2400]]);
  expect(d.rpc).toHaveBeenCalledWith('marey_index', { p_from: '2026-11-02T07:00:00.000Z', p_to: '2026-11-02T13:00:00.000Z' });
  expect((await createMareyIndexHandler(deps())(new Request('http://x/api/marey/index?axe=EST'))).status).toBe(400);
});
