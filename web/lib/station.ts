import { cityOf, type GareRow } from './command';
import { distKm } from './marey-lines';

// Panneau gare de l'accueil (?gare=UIC[,UIC]) : tableau des départs et arrivées lu par station_board.
export const MAX_GARES = 8; // la fonction SQL n'en lit pas plus

export type BoardRow = {
  trip_id: string; train_number: string; brand: string; axis: string; uic: string;
  arr?: string; dep?: string; delay_s?: number; cancelled: boolean; origin?: string; dest?: string; first: boolean; last: boolean;
};
export type Board = { gares: { uic: string; nom: string; lat: number; lon: number }[]; today_trains: number; reg: { n: number; ok: number }; rows: BoardRow[] };
type RawBoard = { gares: [string, string, number, number][]; today_trains: number; reg: { n: number; ok: number }; rows: BoardRow[] };

// Codes UIC de ?gare= : 8 chiffres, sans doublon, 8 au plus ; aucun valide : null.
export function parseGares(param: string | null): string[] | null {
  const uics = [...new Set((param ?? '').split(',').filter((u) => /^\d{8}$/.test(u)))].slice(0, MAX_GARES);
  return uics.length ? uics : null;
}

// Jeu de gares accepté : codes connus, tous à moins de AREA_KM de la première (une ville ou une agglomération, comme les
// regroupements de la barre de commande et du Marey ; sans coordonnées, même ville). Un code inventé ou un mélange de villes
// est refusé avant toute lecture : le nombre de clés de cache (donc d'appels à la base) reste borné (audit du 2026-11-04).
export const AREA_KM = 30;
export function knownArea(uics: string[], gares: GareRow[]): boolean {
  const by = new Map(gares.map((g) => [g[0], g]));
  const rows = uics.map((u) => by.get(u));
  if (rows.length === 0 || rows.some((r) => r === undefined)) return false;
  const [a, ...rest] = rows as GareRow[];
  return rest.every((g) => (a[2] != null && a[3] != null && g[2] != null && g[3] != null
    ? distKm([a[3], a[2]], [g[3], g[2]]) <= AREA_KM
    : cityOf(g[1]) === cityOf(a[1])));
}

// Réponse de station_board vérifiée ; lève si elle est illisible (rien n'est alors mis en cache).
export function shapeBoard(raw: unknown): Board {
  const r = raw as RawBoard;
  if (!r || !Array.isArray(r.gares) || !Array.isArray(r.rows) || typeof r.today_trains !== 'number' || typeof r.reg?.n !== 'number') {
    throw new Error('station_board : réponse invalide');
  }
  return { gares: r.gares.map(([uic, nom, lat, lon]) => ({ uic, nom, lat: Number(lat), lon: Number(lon) })), today_trains: r.today_trains, reg: r.reg, rows: r.rows };
}

// Réponse de /api/gare (déjà mise en forme) vérifiée côté navigateur ; lève si elle est illisible.
export function readBoard(json: unknown): Board {
  const b = json as Board;
  if (!b || !Array.isArray(b.gares) || !Array.isArray(b.rows) || typeof b.today_trains !== 'number' || typeof b.reg?.n !== 'number') {
    throw new Error('/api/gare : réponse invalide');
  }
  return b;
}

// Nom affiché : la gare, ou sa ville quand plusieurs gares sont regroupées.
export function boardTitle(b: Board): string {
  if (b.gares.length === 0) return 'GARE INCONNUE';
  return (b.gares.length === 1 ? b.gares[0].nom : cityOf(b.gares[0].nom)).toUpperCase();
}

export type Tab = 'DEP' | 'ARR';
export type BoardLine = {
  trip_id: string; train_number: string; brand: string; place: string; planned: string; estimated: string;
  delay_s: number; cancelled: boolean; past: boolean;
};
const HHMM = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

// Lignes d'un onglet : départs (pas au terminus) vers la destination, arrivées (pas à l'origine) depuis la provenance.
// Heure estimée = prévue + retard publié (jamais en avance) ; passée = avant maintenant.
export function boardLines(b: Board, tab: Tab, now: Date): BoardLine[] {
  return b.rows
    .filter((r) => (tab === 'DEP' ? !r.last : !r.first))
    .map((r) => {
      const at = Date.parse((tab === 'DEP' ? r.dep ?? r.arr : r.arr ?? r.dep) ?? '');
      const delay = Math.max(r.delay_s ?? 0, 0), est = at + delay * 1000;
      return {
        trip_id: r.trip_id, train_number: r.train_number, brand: r.brand,
        place: (tab === 'DEP' ? r.dest : r.origin) ?? '—', planned: HHMM.format(at), estimated: HHMM.format(est),
        delay_s: delay, cancelled: r.cancelled, past: est < now.getTime(), at,
      };
    })
    .filter((l) => Number.isFinite(l.at))
    .sort((a, b) => a.at - b.at || a.train_number.localeCompare(b.train_number))
    .map(({ at: _at, ...l }) => l);
}

export const regPct = (b: Board) => (b.reg.n === 0 ? null : Math.round((b.reg.ok / b.reg.n) * 1000) / 10);
