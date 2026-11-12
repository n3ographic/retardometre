import { stationName } from './station';

// Rames couplées : réponse de la fonction SQL train_coupling (partenaire = autre numéro qui repart ensemble, voir la migration).
export type RawCoupling = {
  partner: string; date: string; from: [string, string | null]; to: [string, string | null]; together: boolean | null;
};
export type Coupling = { partner: string; date: string; from: string; to: string; together: boolean | null };

const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

// Réponse illisible ou absente : null (la fiche s'affiche sans la ligne).
export function shapeCoupling(raw: unknown): Coupling | null {
  const r = raw as Partial<RawCoupling> | null;
  if (!r || typeof r.partner !== 'string' || !Array.isArray(r.from) || !Array.isArray(r.to) || typeof r.date !== 'string') return null;
  const name = (s: [string, string | null]) => stationName(s[1] ?? s[0]);
  return { partner: r.partner, date: r.date, from: name(r.from), to: name(r.to), together: typeof r.together === 'boolean' ? r.together : null };
}

// Réponse de /api/couplage (déjà mise en forme par le serveur) lue par le navigateur : objet valide ou null.
export function asCoupling(x: unknown): Coupling | null {
  const c = x as Partial<Coupling> | null;
  if (!c || typeof c.partner !== 'string' || typeof c.date !== 'string' || typeof c.from !== 'string' || typeof c.to !== 'string') return null;
  return { partner: c.partner, date: c.date, from: c.from, to: c.to, together: typeof c.together === 'boolean' ? c.together : null };
}

// « Prévu » vient de l'horaire ; le constat n'est ajouté que s'il existe : retards identiques, ou circulé séparément.
export function couplingLabel(c: Coupling): { route: string; seen: string | null } {
  const day = DAY_MONTH.format(new Date(`${c.date}T12:00:00Z`));
  const seen = c.together === false ? `LE ${day}, LES DEUX TRAINS ONT CIRCULÉ SÉPARÉMENT (CONSTATÉ)` : null;
  return { route: `DE ${c.from.toUpperCase()} À ${c.to.toUpperCase()} (PRÉVU)`, seen };
}
