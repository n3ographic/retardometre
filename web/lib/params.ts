// Paramètres volontairement réduits : peu de clés de cache possibles, donc peu d'appels à Supabase.
export type StatsParams = { ok: true; from: string; to: string } | { ok: false; error: string };

const DAY_MS = 86_400_000;
const FIRST_MONTH = '2026-10'; // premier mois avec des données
const PERIODS: Record<string, number> = { '7d': 7, '14d': 14, '31d': 31 };
export const parisDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' });

const dayMs = (s: string) => Date.parse(`${s}T00:00:00Z`);
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Messages fixes : la valeur fournie n'est jamais recopiée.
const fail = (error: string): StatsParams => ({ ok: false, error });

export function parseStatsParams(q: URLSearchParams, now: Date): StatsParams {
  const keys = [...q.keys()];
  if (keys.some((k) => k !== 'period' && k !== 'month')) return fail('paramètre inconnu : seuls « period » ou « month » sont acceptés');
  if (keys.length > 1) return fail('un seul paramètre attendu : « period » ou « month »');

  const today = parisDate.format(now);
  const month = q.get('month');
  if (month !== null) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return fail('mois invalide : AAAA-MM attendu');
    if (month < FIRST_MONTH || month > today.slice(0, 7)) return fail('mois hors de la période couverte');
    const [y, m] = month.split('-').map(Number);
    const last = fmt(Date.UTC(y, m, 0));
    return { ok: true, from: `${month}-01`, to: last < today ? last : today };
  }

  const days = PERIODS[q.get('period') ?? '7d'];
  if (days === undefined) return fail('période invalide : 7d, 14d ou 31d attendu');
  const to = dayMs(today) - DAY_MS;
  return { ok: true, from: fmt(to - (days - 1) * DAY_MS), to: fmt(to) };
}
