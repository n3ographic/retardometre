import { unwrap, type Result } from './db';
import { shapeCumul, type CumulRow } from './cumul';
import { shapeLive, type LiveTrain } from './live';
import { fetchWindow, parseApiParams, shapeMarey, type RawTrain } from './marey';
import { loadRules } from './rules';
import { parseStatsParams } from './params';
import { shapeStats, type Price, type Scale, type StatRow } from './stats';

export type Deps = {
  rpc: (fn: string, args: Record<string, unknown>) => Result;
  select: (table: string, columns: string) => Result;
  now: () => Date;
  // Cache de données serveur : ne mémorise que ce que fn renvoie ; une exception n'est jamais mise en cache.
  cached: <T>(keyParts: string[], revalidateS: number, fn: () => Promise<T>) => Promise<T>;
};

const STATS_CACHE = 'public, s-maxage=900, stale-while-revalidate=300';
// CDN court : le Data Cache (300 s) protège déjà Supabase ; deux caches de 5 min empilés vieillissaient les données jusqu'à ~14 min.
const LIVE_CACHE = 'public, s-maxage=60, stale-while-revalidate=60';
// Même durée que le live : la fenêtre glisse, le seau de 5 min fait varier la clé du Data Cache.
const MAREY_CACHE = 'public, s-maxage=60, stale-while-revalidate=60';
const RULES_CACHE = 'public, s-maxage=3600, stale-while-revalidate=600';
const CUMUL_CACHE = 'public, s-maxage=3600, stale-while-revalidate=600';

const json = (body: unknown, status: number, cache: string) =>
  Response.json(body, { status, headers: { 'Cache-Control': cache } });

// Toute erreur côté base (réponse en erreur, exception, nombre illisible) : 502 jamais mis en cache.
async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    console.error(e);
    return json({ error: 'données momentanément indisponibles' }, 502, 'no-store');
  }
}

export function createStatsHandler(deps: Deps) {
  return async (req: Request) => {
    const p = parseStatsParams(new URL(req.url).searchParams, deps.now());
    if (!p.ok) return json({ error: p.error }, 400, 'no-store');
    // Clé = fenêtre canonique issue de parseStatsParams, jamais une chaîne brute de l'utilisateur.
    return guarded(async () => json(await deps.cached(['stats', 'v3', p.from, p.to], 900, async () => {
      const [rows, prices, scale] = await Promise.all([
        unwrap<StatRow[]>(deps.rpc('stats_period', { p_from: p.from, p_to: p.to }), 'stats_period'),
        unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
        unwrap<Scale[]>(deps.select('compensation_scale', 'brand,from_s,pct,source_url,source_as_of'), 'compensation_scale'),
      ]);
      return shapeStats(rows, prices, scale, { from: p.from, to: p.to }); // lève si invalide : rien n'est mis en cache
    }), 200, STATS_CACHE));
  };
}

export function createLiveHandler(deps: Deps) {
  return async (req: Request) => {
    // Aucun paramètre : une seule clé de cache.
    if (new URL(req.url).search !== '') return json({ error: 'aucun paramètre accepté' }, 400, 'no-store');
    return guarded(async () => json(await deps.cached(['live', 'v3'], 300, async () => {
      const [trains, prices] = await Promise.all([
        unwrap<LiveTrain[]>(deps.rpc('live_trains', {}), 'live_trains'),
        unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
      ]);
      return shapeLive(trains, prices, deps.now()); // generated_at fixé dans l'unité mise en cache
    }), 200, LIVE_CACHE));
  };
}

export function createRulesHandler(deps: Deps) {
  return async (req: Request) => {
    // Aucun paramètre : une seule clé de cache, refus avant toute lecture de la base.
    if (new URL(req.url).search !== '') return json({ error: 'aucun paramètre accepté' }, 400, 'no-store');
    return guarded(async () => json(await loadRules(deps), 200, RULES_CACHE));
  };
}

export function createCumulHandler(deps: Deps) {
  return async (req: Request) => {
    // Aucun paramètre : une seule clé de cache, refus avant toute lecture de la base.
    if (new URL(req.url).search !== '') return json({ error: 'aucun paramètre accepté' }, 400, 'no-store');
    return guarded(async () => json(await deps.cached(['cumul', 'v2'], 3600, async () => {
      const [rows, prices] = await Promise.all([
        unwrap<CumulRow[]>(deps.rpc('cumul_totals', {}), 'cumul_totals'),
        unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
      ]);
      return shapeCumul(rows, prices); // lève si invalide : rien n'est mis en cache
    }), 200, CUMUL_CACHE));
  };
}

export function createMareyHandler(deps: Deps) {
  return async (req: Request) => {
    const p = parseApiParams(new URL(req.url).searchParams);
    if (!p.ok) return json({ error: p.error }, 400, 'no-store');
    const w = fetchWindow(deps.now());
    // Clé = axe validé + seau de 5 min, jamais une chaîne brute de l'utilisateur.
    return guarded(async () => json(await deps.cached(['marey', 'v1', p.axe, String(w.bucket)], 300, async () => {
      const [trains, prices] = await Promise.all([
        unwrap<RawTrain[]>(deps.rpc('marey_trains', { p_axis: p.axe, p_from: w.from, p_to: w.to }), 'marey_trains'),
        unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
      ]);
      return shapeMarey(p.axe, trains, prices, new Date(w.bucket * 1000)); // lève si invalide : rien n'est mis en cache
    }), 200, MAREY_CACHE));
  };
}
