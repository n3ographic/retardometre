import { unwrap, type Result } from './db';
import { shapeCumul, type CumulRow } from './cumul';
import { shapeLive, type LiveTrain } from './live';
import { shapeProfile, type Profile, type RawProfile } from './train-profile';
import { BLOCK_S, BUCKET_S, COLLECT_INTERVAL_S, HALF_WINDOW_S, PAST_TTL_S, fetchWindow, parseApiParams, shapeMarey, type RawTrain, type StopRow } from './marey';
import { loadRules } from './rules';
import { parseGares, shapeBoard } from './station';
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
    return guarded(async () => json(await deps.cached(['stats', 'v4', p.from, p.to], 900, async () => {
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
    const nowS = Math.floor(deps.now().getTime() / 1000);
    const p = parseApiParams(new URL(req.url).searchParams, nowS);
    if (!p.ok) return json({ error: p.error }, 400, 'no-store');
    // Sans tranche : la fenêtre autour de maintenant. Avec : la tranche demandée, en cache 1 h si elle est finie depuis plus d'une heure.
    const fw = fetchWindow(deps.now());
    const past = p.bloc !== null && p.bloc + BLOCK_S < nowS - PAST_TTL_S;
    const ttl = past ? PAST_TTL_S : BUCKET_S;
    const w = p.bloc === null ? fw : { bucket: Math.floor(nowS / ttl) * ttl, from: new Date(p.bloc * 1000).toISOString(), to: new Date((p.bloc + BLOCK_S) * 1000).toISOString() };
    // Clé = axe et tranche validés + seau de temps, jamais une chaîne brute de l'utilisateur. Les gares (244 lignes) sont relues une fois par jour.
    return guarded(async () => json(await deps.cached(['marey', 'v3', p.axe, String(p.bloc ?? 'now'), String(w.bucket)], ttl, async () => {
      const [trains, prices, stops] = await Promise.all([
        unwrap<RawTrain[]>(deps.rpc('marey_trains', { p_axis: p.axe, p_from: w.from, p_to: w.to }), 'marey_trains'),
        unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
        deps.cached(['marey-gares', 'v1'], 86_400, () => unwrap<StopRow[]>(deps.select('stops', 'stop_id,name,lat,lon'), 'stops')),
      ]);
      // generated_at = heure réelle de la requête (pas le début du seau) : le bandeau en déduit le retard de la collecte.
      return shapeMarey(p.axe, trains, prices, stops, deps.now()); // lève si invalide : rien n'est mis en cache
    }), 200, MAREY_CACHE));
  };
}

// Fiche d'un train (page /train/XXXX et son image de partage) : un appel à train_profile par numéro et par cycle de
// collecte (2 min). Numéro invalide ou inconnu : null. Erreur de base : lève (rien n'est mis en cache).
export async function loadTrainProfile(deps: Deps, number: string): Promise<Profile | null> {
  if (!/^\d{1,5}$/.test(number)) return null;
  const cycle = Math.floor(deps.now().getTime() / 1000 / COLLECT_INTERVAL_S);
  return deps.cached(['train', 'v1', number, String(cycle)], COLLECT_INTERVAL_S, async () => {
    const [raw, prices] = await Promise.all([
      deps.rpc('train_profile', { p_number: number }).then(({ data, error }) => {
        if (error || (data !== null && (typeof data !== 'object' || !Array.isArray((data as RawProfile).days)))) throw new Error('lecture de train_profile impossible');
        return data as RawProfile | null; // objet, ou null pour un numéro inconnu
      }),
      unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
    ]);
    return raw ? shapeProfile(number, raw, prices) : null;
  });
}

// Toutes les gares, une par code UIC : [uic, nom] triées par nom (barre de commande). Même lecture des arrêts que le Marey.
export function createGaresHandler(deps: Deps) {
  return async (req: Request) => {
    if (new URL(req.url).search !== '') return json({ error: 'aucun paramètre accepté' }, 400, 'no-store');
    return guarded(async () => {
      const stops = await deps.cached(['marey-gares', 'v1'], 86_400, () => unwrap<StopRow[]>(deps.select('stops', 'stop_id,name,lat,lon'), 'stops'));
      const byUic = new Map<string, string>();
      for (const s of stops) if (!byUic.has(s.stop_id.slice(-8))) byUic.set(s.stop_id.slice(-8), s.name);
      return json({ gares: [...byUic].sort((a, b) => a[1].localeCompare(b[1], 'fr')) }, 200, CUMUL_CACHE);
    });
  };
}

// Panneau gare (?gare=UIC[,UIC]) : un appel à station_board par jeu de gares et par cycle de collecte (2 min).
export function createStationHandler(deps: Deps) {
  return async (req: Request) => {
    const uics = parseGares(new URL(req.url).searchParams.get('uic'));
    if (!uics) return json({ error: 'paramètre uic : codes UIC de 8 chiffres séparés par des virgules' }, 400, 'no-store');
    const cycle = Math.floor(deps.now().getTime() / 1000 / COLLECT_INTERVAL_S);
    // Clé = codes validés et triés + cycle, jamais une chaîne brute de l'utilisateur.
    return guarded(async () => json(await deps.cached(['gare', 'v1', [...uics].sort().join(','), String(cycle)], COLLECT_INTERVAL_S, async () => {
      const { data, error } = await deps.rpc('station_board', { p_uics: uics });
      if (error) throw new Error('lecture de station_board impossible');
      return { generated_at: deps.now().toISOString(), ...shapeBoard(data) }; // lève si invalide : rien n'est mis en cache
    }), 200, LIVE_CACHE));
  };
}

// Index léger des trains de la fenêtre, tous axes : [axe, numéro, origine, destination, retard au terminus].
export function createMareyIndexHandler(deps: Deps) {
  return async (req: Request) => {
    if (new URL(req.url).search !== '') return json({ error: 'aucun paramètre accepté' }, 400, 'no-store');
    const w = fetchWindow(deps.now());
    // Fenêtre affichée (±3 h), pas la marge de la requête des trains : les compteurs d'axe et de branche portent sur la même plage.
    const at = (s: number) => new Date((w.bucket + s) * 1000).toISOString();
    return guarded(async () => json(await deps.cached(['marey-index', 'v2', String(w.bucket)], BUCKET_S, async () => {
      const trains = await unwrap<unknown[]>(deps.rpc('marey_index', { p_from: at(-HALF_WINDOW_S), p_to: at(HALF_WINDOW_S) }), 'marey_index');
      if (!Array.isArray(trains)) throw new Error('marey_index : réponse invalide');
      return { generated_at: new Date(w.bucket * 1000).toISOString(), trains };
    }), 200, MAREY_CACHE));
  };
}
