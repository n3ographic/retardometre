import { unwrap, type Result } from './db';
import { addDays, shapeCumul, withLive, type CumulPayload, type CumulRow } from './cumul';
import { shapeLive, type LiveTrain } from './live';
import { shapeProfile, type Profile, type RawProfile } from './train-profile';
import { shapeCoupling, type Coupling } from './train-coupling';
import { BLOCK_S, BUCKET_S, COLLECT_INTERVAL_S, HALF_WINDOW_S, PAST_TTL_S, fetchWindow, parseApiParams, shapeMarey, type RawTrain, type StopRow } from './marey';
import { loadRules } from './rules';
import { knownArea, parseGares, shapeBoard } from './station';
import { WEEK_RE, type WeekExtra, type WeekRow } from './weekly';
import type { GareRow } from './command';
import { parisDate, parseStatsParams } from './params';
import { SCALE_COLUMNS, shapeStats, type Price, type Scale, type StatRow } from './stats';

export type Deps = {
  rpc: (fn: string, args: Record<string, unknown>) => Result;
  select: (table: string, columns: string, match?: Record<string, string>) => Result; // match : égalités colonne = valeur
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
const CUMUL_CACHE = 'public, s-maxage=300, stale-while-revalidate=60';

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
    return guarded(async () => json(await deps.cached(['stats', 'v6', p.from, p.to], 900, async () => {
      const [rows, prices, scale] = await Promise.all([
        unwrap<StatRow[]>(deps.rpc('stats_period', { p_from: p.from, p_to: p.to }), 'stats_period'),
        unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
        unwrap<Scale[]>(deps.select('compensation_scale', SCALE_COLUMNS), 'compensation_scale'),
      ]);
      // lève si invalide : rien n'est mis en cache
      return { ...shapeStats(rows, prices, scale, { from: p.from, to: p.to }), computed_at: deps.now().toISOString() };
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
    return guarded(async () => json(await deps.cached(['cumul', 'v5'], 300, async (): Promise<CumulPayload> => {
      const now = deps.now();
      const day = parisDate.format(now);
      const rows = await unwrap<CumulRow[]>(deps.rpc('cumul_totals', {}), 'cumul_totals');
      // Jours pas encore enregistrés par la tâche de nuit (la veille avant 05:30), puis le jour en cours.
      const from = rows[0] ? addDays(rows[0].last_day, 1) : day;
      const [gap, today, prices, scale] = await Promise.all([
        from < day ? unwrap<StatRow[]>(deps.rpc('stats_period', { p_from: from, p_to: addDays(day, -1) }), 'stats_period') : Promise.resolve([]),
        unwrap<StatRow[]>(deps.rpc('stats_period', { p_from: day, p_to: day }), 'stats_period'),
        unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
        unwrap<Scale[]>(deps.select('compensation_scale', SCALE_COLUMNS), 'compensation_scale'),
      ]);
      return { // lève si invalide : rien n'est mis en cache
        ...shapeCumul(withLive(rows, [...gap, ...today], from, day), prices),
        today: shapeStats(today, prices, scale, { from: day, to: day }).totals,
        computed_at: now.toISOString(),
      };
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
    return guarded(async () => json(await deps.cached(['marey', 'v4', p.axe, String(p.bloc ?? 'now'), String(w.bucket)], ttl, async () => {
      const [trains, prices, stops, scale] = await Promise.all([
        unwrap<RawTrain[]>(deps.rpc('marey_trains', { p_axis: p.axe, p_from: w.from, p_to: w.to }), 'marey_trains'),
        unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
        deps.cached(['marey-gares', 'v1'], 86_400, () => unwrap<StopRow[]>(deps.select('stops', 'stop_id,name,lat,lon'), 'stops')),
        unwrap<Scale[]>(deps.select('compensation_scale', SCALE_COLUMNS), 'compensation_scale'),
      ]);
      // generated_at = heure réelle de la requête (pas le début du seau) : le bandeau en déduit le retard de la collecte.
      return shapeMarey(p.axe, trains, prices, stops, deps.now(), scale); // lève si invalide : rien n'est mis en cache
    }), 200, MAREY_CACHE));
  };
}

// Fiche d'un train (page /train/XXXX et son image de partage) : un appel à train_profile par numéro et par cycle de
// collecte (2 min). Numéro invalide ou inconnu : null. Erreur de base : lève (rien n'est mis en cache).
export async function loadTrainProfile(deps: Deps, number: string): Promise<Profile | null> {
  if (!/^\d{1,5}$/.test(number)) return null;
  const cycle = Math.floor(deps.now().getTime() / 1000 / COLLECT_INTERVAL_S);
  return deps.cached(['train', 'v2', number, String(cycle)], COLLECT_INTERVAL_S, async () => {
    const [raw, prices, scale] = await Promise.all([
      deps.rpc('train_profile', { p_number: number }).then(({ data, error }) => {
        if (error || (data !== null && (typeof data !== 'object' || !Array.isArray((data as RawProfile).days)))) throw new Error('lecture de train_profile impossible');
        return data as RawProfile | null; // objet, ou null pour un numéro inconnu
      }),
      unwrap<Price[]>(deps.select('reference_prices', 'brand,price_eur_ht,seats,price_source,seats_source,as_of'), 'reference_prices'),
      unwrap<Scale[]>(deps.select('compensation_scale', SCALE_COLUMNS), 'compensation_scale'),
    ]);
    return raw ? shapeProfile(number, raw, prices, scale) : null;
  });
}

// Rames couplées de la fiche : un appel à train_coupling par numéro et par cycle. Jamais bloquant : fonction absente
// (migration pas encore appliquée) ou erreur de base, la fiche s'affiche sans la ligne (rien n'est mis en cache).
export async function loadTrainCoupling(deps: Deps, number: string): Promise<Coupling | null> {
  if (!/^\d{1,5}$/.test(number)) return null;
  const cycle = Math.floor(deps.now().getTime() / 1000 / COLLECT_INTERVAL_S);
  try {
    return await deps.cached(['train-coupling', 'v1', number, String(cycle)], COLLECT_INTERVAL_S, async () => {
      const { data, error } = await deps.rpc('train_coupling', { p_number: number });
      if (error) throw new Error('lecture de train_coupling impossible');
      return shapeCoupling(data);
    });
  } catch (e) {
    console.error(e);
    return null;
  }
}

// Toutes les gares, une par code UIC : [uic, nom, lat, lon] triées par nom (barre de commande, gares de la carte, liens
// vers le panneau gare). Coordonnées du premier point d'arrêt qui en a ; aucune : [uic, nom]. Même lecture des arrêts que le Marey.
export async function loadGares(deps: Deps): Promise<GareRow[]> {
  const stops = await deps.cached(['marey-gares', 'v1'], 86_400, () => unwrap<StopRow[]>(deps.select('stops', 'stop_id,name,lat,lon'), 'stops'));
  const byUic = new Map<string, GareRow>();
  for (const s of stops) {
    const uic = s.stop_id.slice(-8), has = s.lat !== null && s.lon !== null;
    if (!byUic.has(uic) || (has && byUic.get(uic)!.length === 2)) byUic.set(uic, has ? [uic, s.name, Number(s.lat), Number(s.lon)] : [uic, s.name]);
  }
  return [...byUic.values()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
}

// Semaines déjà calculées (weekly_reports), dans l'ordre ; une nouvelle semaine apparaît en 10 min au plus.
export const loadWeeks = (deps: Deps) => deps.cached(['weeks', 'v1'], 600, async () =>
  (await unwrap<{ week: string }[]>(deps.select('weekly_reports', 'week'), 'weekly_reports')).map((r) => r.week).sort());

// Bilan figé d'une semaine et de la précédente (variations) ; null si la semaine n'est pas calculée (jamais mis en cache).
export async function loadWeek(deps: Deps, week: string): Promise<{ row: WeekRow; prev: WeekRow | null; weeks: string[]; extra: WeekExtra | null } | null> {
  if (!WEEK_RE.test(week)) return null;
  const weeks = await loadWeeks(deps);
  const i = weeks.indexOf(week);
  if (i < 0) return null;
  const read = async (w: string) => (await unwrap<WeekRow[]>(deps.select('weekly_reports', 'week,monday,payload,computed_at', { week: w }), 'weekly_reports'))[0] ?? null;
  // Une correction manuelle (snapshot_week) apparaît en 1 h au plus.
  const [row, prev, extra] = await deps.cached(['week', 'v2', week], 3600, async () => {
    const [r, pr] = await Promise.all([read(week), i > 0 ? read(weeks[i - 1]) : Promise.resolve(null)]);
    // Bilan figé avant la part en bons : bons et plafond international recalculés à part, totaux figés inchangés.
    if (!r || r.payload.stats.some((x) => x[2] === 'comp_pct_sum_bon')) return [r, pr, null] as const;
    const rows = await unwrap<StatRow[]>(deps.rpc('stats_period', { p_from: r.payload.from, p_to: r.payload.to }), 'stats_period');
    const tt = shapeStats(rows, r.payload.prices, r.payload.scale, { from: r.payload.from, to: r.payload.to }).totals;
    return [r, pr, { bon: tt.estimated_cost_eur_ht_bon, intl_cap: tt.intl_cap_eur_ht }] as const;
  });
  return row ? { row, prev, weeks, extra } : null;
}

export function createGaresHandler(deps: Deps) {
  return async (req: Request) => {
    if (new URL(req.url).search !== '') return json({ error: 'aucun paramètre accepté' }, 400, 'no-store');
    return guarded(async () => {
      return json({ gares: await loadGares(deps) }, 200, RULES_CACHE);
    });
  };
}

// Panneau gare (?gare=UIC[,UIC]) : un appel à station_board par jeu de gares et par cycle de collecte (2 min).
export function createStationHandler(deps: Deps) {
  return async (req: Request) => {
    const uics = parseGares(new URL(req.url).searchParams.get('uic'));
    if (!uics) return json({ error: 'paramètre uic : codes UIC de 8 chiffres séparés par des virgules' }, 400, 'no-store');
    const cycle = Math.floor(deps.now().getTime() / 1000 / COLLECT_INTERVAL_S);
    return guarded(async () => {
      // Gares connues et voisines seulement (liste relue une fois par jour) : sinon 404, sans lecture de station_board.
      if (!knownArea(uics, await loadGares(deps))) return json({ error: 'gares inconnues ou trop éloignées les unes des autres' }, 404, 'no-store');
      // Clé = codes validés et triés + cycle, jamais une chaîne brute de l'utilisateur.
      return json(await deps.cached(['gare', 'v1', [...uics].sort().join(','), String(cycle)], COLLECT_INTERVAL_S, async () => {
        const { data, error } = await deps.rpc('station_board', { p_uics: uics });
        if (error) throw new Error('lecture de station_board impossible');
        return { generated_at: deps.now().toISOString(), ...shapeBoard(data) }; // lève si invalide : rien n'est mis en cache
      }), 200, LIVE_CACHE);
    });
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
