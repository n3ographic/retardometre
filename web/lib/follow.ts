import type { Result } from './db';

// POST /api/follow : suivre un train, changer de gare, arrêter (fonctions follow_* en base, clé anon).
// La base fait les vrais contrôles (train du jour, gare du parcours, service de push connu, 10 suivis) ;
// ici seulement la forme, pour ne pas l'appeler pour rien.
type Deps = { rpc: (fn: string, args: Record<string, unknown>) => Result };

const NUMBER = /^\d{1,5}$/;
const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const ERRORS: Record<string, [number, string]> = {
  '22023': [400, 'abonnement ou gare invalide'],
  P0002: [404, 'train introuvable ou déjà arrivé'],
  '54000': [429, 'trop de trains suivis'],
};

function parse(raw: string): [string, Record<string, unknown>] | null {
  if (raw.length > 4096) return null;
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return null; }
  if (!b || typeof b !== 'object' || !str(b.endpoint, 1000) || typeof b.number !== 'string' || !NUMBER.test(b.number)) return null;
  const base = { p_endpoint: b.endpoint, p_number: b.number };
  if (b.action === 'add' && str(b.p256dh, 200) && str(b.auth, 100)) {
    return ['follow_add', { p_endpoint: b.endpoint, p_p256dh: b.p256dh, p_auth: b.auth, p_number: b.number }];
  }
  if (b.action === 'stop' && Number.isInteger(b.seq) && (b.seq as number) >= 0) return ['follow_set_stop', { ...base, p_seq: b.seq }];
  if (b.action === 'remove') return ['follow_remove', base];
  return null;
}

export function createFollowHandler(deps: Deps) {
  return async (req: Request) => {
    const call = parse(await req.text());
    if (!call) return json({ error: 'requête invalide' }, 400);
    try {
      const { data, error } = await deps.rpc(...call);
      if (error) {
        const [status, message] = ERRORS[(error as { code?: string }).code ?? ''] ?? [502, 'service momentanément indisponible'];
        if (status === 502) console.error(error);
        return json({ error: message }, status);
      }
      return json(data, 200);
    } catch (e) {
      console.error(e);
      return json({ error: 'service momentanément indisponible' }, 502);
    }
  };
}
