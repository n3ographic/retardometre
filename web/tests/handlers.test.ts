import { beforeEach, expect, test, vi } from 'vitest';
import { createCumulHandler, createLiveHandler, createRulesHandler, createStatsHandler, type Deps } from '../lib/handlers';
import { prices, scale } from './fixtures';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

const now = () => new Date('2026-10-21T10:00:00Z');
const okDeps = () => ({
  rpc: vi.fn(async (fn: string) => ({ data: fn === 'live_trains' ? [{ trip_id: 't', brand: 'INOUI', comp_pct: 50 }] : [{ brand: 'INOUI', axis: 'EST', metric: 'planned', n: '3' }], error: null })),
  select: vi.fn(async (table: string) => ({ data: table === 'reference_prices' ? prices : scale, error: null })),
  now,
  cached: <T>(_k: string[], _s: number, fn: () => Promise<T>) => fn(),
});

// Faux cache de données : Map + TTL, clé = keyParts.join('|'), une erreur n'est pas mémorisée.
function fakeCache() {
  const store = new Map<string, { until: number; value: unknown }>();
  const mock = vi.fn<Deps['cached']>(async <T>(keyParts: string[], revalidateS: number, fn: () => Promise<T>): Promise<T> => {
    const key = keyParts.join('|'), hit = store.get(key);
    if (hit && hit.until > Date.now()) return hit.value as T;
    const value = await fn();
    store.set(key, { until: Date.now() + revalidateS * 1000, value });
    return value;
  });
  // Mock perd la signature générique : on la rétablit pour Deps.
  return { cached: mock as typeof mock & Deps['cached'], store };
}

test('succès : 200, JSON et Cache-Control exact (stats et temps réel)', async () => {
  const deps = okDeps();
  const s = await createStatsHandler(deps)(new Request('http://x/api/stats?period=7d'));
  expect(s.status).toBe(200);
  expect(s.headers.get('cache-control')).toBe('public, s-maxage=900, stale-while-revalidate=300');
  expect(s.headers.get('content-type')).toContain('application/json');
  expect((await s.json()).totals.planned).toBe(3);
  expect(deps.rpc).toHaveBeenCalledWith('stats_period', { p_from: '2026-10-14', p_to: '2026-10-20' });

  const l = await createLiveHandler(okDeps())(new Request('http://x/api/live'));
  expect(l.status).toBe(200);
  expect(l.headers.get('cache-control')).toBe('public, s-maxage=60, stale-while-revalidate=60');
  const body = await l.json();
  expect(body.generated_at).toBe('2026-10-21T10:00:00.000Z');
  expect(body.trains[0].comp_eur_per_passenger_ref).toBe(23.3);
});

test.each([
  'occupancy=5', 'foo=1', 'occupancy=0.5', 'from=2026-10-20&to=2026-10-21', 'period=8d', 'period=7D',
  'period=7d&month=2026-10', 'period=7d&period=14d', 'month=2026-09', 'month=2099-01', 'month=2026-13',
])('paramètres invalides (%s) : 400, no-store, la base n’est pas appelée', async (qs) => {
  const deps = okDeps();
  const res = await createStatsHandler(deps)(new Request(`http://x/api/stats?${qs}`));
  expect(res.status).toBe(400);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(typeof (await res.json()).error).toBe('string');
  expect(deps.rpc).not.toHaveBeenCalled(); expect(deps.select).not.toHaveBeenCalled();
});

test('/api/live avec un paramètre : 400, no-store, la base n’est pas appelée', async () => {
  const deps = okDeps();
  const res = await createLiveHandler(deps)(new Request('http://x/api/live?x=1'));
  expect(res.status).toBe(400);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(deps.rpc).not.toHaveBeenCalled(); expect(deps.select).not.toHaveBeenCalled();
});

test('month valide : la base reçoit le mois borné à aujourd’hui', async () => {
  const deps = okDeps();
  const res = await createStatsHandler(deps)(new Request('http://x/api/stats?month=2026-10'));
  expect(res.status).toBe(200);
  expect(deps.rpc).toHaveBeenCalledWith('stats_period', { p_from: '2026-10-01', p_to: '2026-10-21' });
});

test('la base renvoie autre chose qu’un tableau : 502, no-store', async () => {
  for (const make of [createStatsHandler, createLiveHandler]) {
    const deps = { ...okDeps(), rpc: vi.fn(async () => ({ data: { not: 'array' }, error: null })) };
    const res = await make(deps)(new Request('http://x/api/x'));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  }
});

test('la base répond en erreur : 502, no-store, pas de corps trompeur', async () => {
  for (const make of [createStatsHandler, createLiveHandler]) {
    const deps = { ...okDeps(), select: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) };
    const res = await make(deps)(new Request('http://x/api/x'));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['error']);
  }
});

test('la base lève une exception : 502, no-store', async () => {
  for (const make of [createStatsHandler, createLiveHandler]) {
    const deps = { ...okDeps(), rpc: vi.fn(async () => { throw new Error('réseau'); }) };
    const res = await make(deps)(new Request('http://x/api/x'));
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  }
});

test('nombre illisible venant de la base : 502 plutôt que NaN', async () => {
  const deps = { ...okDeps(), rpc: vi.fn(async () => ({ data: [{ brand: 'INOUI', axis: 'EST', metric: 'planned', n: 'abc' }], error: null })) };
  const res = await createStatsHandler(deps)(new Request('http://x/api/stats'));
  expect(res.status).toBe(502);
});

test('même fenêtre canonique : la base n’est appelée qu’une fois', async () => {
  const { cached, store } = fakeCache();
  const deps = { ...okDeps(), cached };
  const h = createStatsHandler(deps);
  for (const qs of ['', '?period=7d', '?period=7d', '', '?period=7d']) expect((await h(new Request(`http://x/api/stats${qs}`))).status).toBe(200);
  expect(deps.rpc).toHaveBeenCalledTimes(1); expect(deps.select).toHaveBeenCalledTimes(2);
  expect([...store.keys()]).toEqual(['stats|v5|2026-10-14|2026-10-20']); // v5 : la forme de la réponse a changé (computed_at), le cache survit aux déploiements
  expect(cached.mock.calls[0][1]).toBe(900);
  await h(new Request('http://x/api/stats?period=14d'));
  expect(deps.rpc).toHaveBeenCalledTimes(2);
});

test.each([
  ['objet erreur', async () => ({ data: null, error: { message: 'boom' } })],
  ['exception', async () => { throw new Error('réseau'); }],
  ['pas un tableau', async () => ({ data: { x: 1 }, error: null })],
  ['nombre illisible', async () => ({ data: [{ brand: 'INOUI', axis: 'EST', metric: 'planned', n: 'abc' }], error: null })],
])('échec de la base (%s) : 502 no-store, jamais mis en cache', async (_n, failing) => {
  const { cached, store } = fakeCache();
  const deps = { ...okDeps(), cached };
  deps.rpc.mockImplementationOnce(failing as never);
  const h = createStatsHandler(deps);
  const bad = await h(new Request('http://x/api/stats'));
  expect(bad.status).toBe(502); expect(bad.headers.get('cache-control')).toBe('no-store');
  expect(store.size).toBe(0);
  expect((await h(new Request('http://x/api/stats'))).status).toBe(200);
  expect(deps.rpc).toHaveBeenCalledTimes(2);
});

test('live : 5 requêtes, un seul appel et le même generated_at', async () => {
  const { cached } = fakeCache();
  let t = 0;
  const deps = { ...okDeps(), cached, now: () => new Date(Date.UTC(2026, 9, 21, 10, 0, t++)) };
  const h = createLiveHandler(deps);
  const stamps = new Set<string>();
  for (let i = 0; i < 5; i++) stamps.add((await (await h(new Request('http://x/api/live'))).json()).generated_at);
  expect(deps.rpc).toHaveBeenCalledTimes(1);
  expect(stamps.size).toBe(1);
  expect(cached.mock.calls[0].slice(0, 2)).toEqual([['live', 'v3'], 300]);
});

test('/api/live?x=1 : 400 sans toucher au cache', async () => {
  const { cached } = fakeCache();
  const res = await createLiveHandler({ ...okDeps(), cached })(new Request('http://x/api/live?x=1'));
  expect(res.status).toBe(400); expect(cached).not.toHaveBeenCalled();
});

const regularityRows = [{ duration_from_s: '0', max_delay_exclusive_s: '300', source_url: 'u' }];
const rulesDeps = () => ({
  ...okDeps(),
  select: vi.fn(async (table: string) => ({
    data: table === 'reference_prices' ? prices : table === 'compensation_scale' ? scale : regularityRows, error: null,
  })),
});

test('rules : 200, quatre clés, nombres, Cache-Control exact, clé et durée du cache', async () => {
  const { cached } = fakeCache();
  const res = await createRulesHandler({ ...rulesDeps(), cached })(new Request('http://x/api/rules'));
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('public, s-maxage=3600, stale-while-revalidate=600');
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(['compensation_scale', 'generated_at', 'reference_prices', 'regularity_rule']);
  expect(typeof body.reference_prices[0].price_eur_ht).toBe('number');
  expect(body.regularity_rule[0]).toMatchObject({ duration_from_s: 0, max_delay_exclusive_s: 300 });
  expect(cached.mock.calls[0].slice(0, 2)).toEqual([['rules', 'v1'], 3600]);
});

test('/api/rules?x=1 : 400 no-store, avant toute lecture', async () => {
  const deps = rulesDeps();
  const res = await createRulesHandler(deps)(new Request('http://x/api/rules?x=1'));
  expect(res.status).toBe(400);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(deps.select).not.toHaveBeenCalled();
});

test('rules : lecture en erreur = 502 no-store, rien de mémorisé, reprise au second appel', async () => {
  const { cached, store } = fakeCache();
  const deps = { ...rulesDeps(), cached };
  deps.select.mockImplementationOnce((async () => ({ data: null, error: { message: 'x' } })) as never);
  const h = createRulesHandler(deps);
  const bad = await h(new Request('http://x/api/rules'));
  expect(bad.status).toBe(502); expect(bad.headers.get('cache-control')).toBe('no-store');
  expect(store.size).toBe(0);
  expect((await h(new Request('http://x/api/rules'))).status).toBe(200);
});

const cumulRows = [
  { brand: 'INOUI', metric: 'planned', n: '10', days: 1, first_day: '2026-10-20', last_day: '2026-10-20' },
  { brand: 'INOUI', metric: 'observed', n: 4, days: 1, first_day: '2026-10-20', last_day: '2026-10-20' },
  { brand: 'INOUI', metric: 'comp_pct_sum', n: 50, days: 1, first_day: '2026-10-20', last_day: '2026-10-20' },
];
const liveRows = [
  { brand: 'INOUI', axis: 'ATLANTIQUE', metric: 'planned', n: 6 },
  { brand: 'INOUI', axis: 'ATLANTIQUE', metric: 'observed', n: 6 },
  { brand: 'INOUI', axis: 'ATLANTIQUE', metric: 'circulated', n: 6 },
  { brand: 'INOUI', axis: 'ATLANTIQUE', metric: 'on_time_official', n: 3 },
];
const cumulDeps = (live: unknown[] = []) => ({
  ...okDeps(),
  rpc: vi.fn(async (fn: string) => ({ data: fn === 'cumul_totals' ? cumulRows : live, error: null })),
});

test('cumul : 200, forme, Cache-Control exact, clé et durée du cache', async () => {
  const { cached } = fakeCache();
  const deps = { ...cumulDeps(), cached };
  const res = await createCumulHandler(deps)(new Request('http://x/api/cumul'));
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('public, s-maxage=300, stale-while-revalidate=60');
  const body = await res.json();
  expect(body).toMatchObject({ since: '2026-10-20', through: '2026-10-20', days: 1, planned: 10, observed: 4, coverage_pct: 40 });
  expect(typeof body.cost_eur_ht).toBe('number');
  expect(body.computed_at).toBe(deps.now().toISOString());
  expect(body.today.circulated).toBe(0);
  expect(deps.rpc).toHaveBeenCalledWith('cumul_totals', {});
  expect(cached.mock.calls[0].slice(0, 2)).toEqual([['cumul', 'v3'], 300]);
});

test('cumul : jours manquants puis jour en cours calculés à la volée, ligne AUJOURD\'HUI', async () => {
  const deps = { ...cumulDeps(liveRows), now: () => new Date('2026-10-23T10:00:00Z') };
  const body = await (await createCumulHandler(deps)(new Request('http://x/api/cumul'))).json();
  // daily_stats s'arrête au 20/10 : 21 et 22 en un appel, le 23 à part.
  expect(deps.rpc).toHaveBeenCalledWith('stats_period', { p_from: '2026-10-21', p_to: '2026-10-22' });
  expect(deps.rpc).toHaveBeenCalledWith('stats_period', { p_from: '2026-10-23', p_to: '2026-10-23' });
  expect(body).toMatchObject({ since: '2026-10-20', through: '2026-10-23', days: 4, planned: 22, observed: 16 });
  expect(body.today).toMatchObject({ circulated: 6, official_regularity_pct: 50 });
});

test('/api/cumul?x=1 : 400 no-store avant toute lecture', async () => {
  const deps = cumulDeps();
  const res = await createCumulHandler(deps)(new Request('http://x/api/cumul?x=1'));
  expect(res.status).toBe(400);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(deps.rpc).not.toHaveBeenCalled();
  expect(deps.select).not.toHaveBeenCalled();
});

test('cumul : échec de la base = 502 no-store, rien de mémorisé, reprise au second appel', async () => {
  const { cached, store } = fakeCache();
  const deps = { ...cumulDeps(), cached };
  deps.rpc.mockImplementationOnce((async () => ({ data: null, error: { message: 'x' } })) as never);
  const h = createCumulHandler(deps);
  const bad = await h(new Request('http://x/api/cumul'));
  expect(bad.status).toBe(502); expect(bad.headers.get('cache-control')).toBe('no-store');
  expect(store.size).toBe(0);
  expect((await h(new Request('http://x/api/cumul'))).status).toBe(200);
});
