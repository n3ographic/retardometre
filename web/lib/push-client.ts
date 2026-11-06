// Côté navigateur : Web Push disponible ?, abonnement, appels à /api/follow et trains suivis retenus localement.
// La base garde la vérité (train_follows) ; le stockage local sert seulement à afficher la cloche pleine.

export type Followed = { number: string; date: string; seq: number; stops: [number, string][] };
export type Support = 'ok' | 'ios-install' | 'unsupported';

const KEY = 'follows-v1';
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
const parisDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

// Suivis encore utiles : jour de service d'aujourd'hui ou d'hier (trains de nuit), comme follow_trip en base.
export function prune(list: Followed[], now: Date): Followed[] {
  const yesterday = parisDate(new Date(now.getTime() - 86_400_000));
  return list.filter((f) => f.date >= yesterday);
}

export function readFollows(now = new Date()): Followed[] {
  try { return prune(JSON.parse(localStorage.getItem(KEY) ?? '[]'), now); } catch { return []; }
}
function writeFollows(list: Followed[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* navigation privée : la cloche ne restera pas pleine */ }
}

export function pushSupport(): Support {
  if (typeof window === 'undefined' || !VAPID) return 'unsupported';
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // Safari sur iPhone n'expose PushManager qu'une fois le site ajouté à l'écran d'accueil.
  return ok ? 'ok' : ios ? 'ios-install' : 'unsupported';
}

export const registerWorker = () => navigator.serviceWorker.register('/sw.js');

const key = (b64: string) => {
  const raw = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function subscription(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID) });
}

async function api(body: Record<string, unknown>) {
  const res = await fetch('/api/follow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'service momentanément indisponible');
  return data;
}

// À appeler directement dans le clic : iOS exige la demande d'autorisation dans un geste de l'utilisateur.
export async function follow(number: string): Promise<Followed> {
  if (await Notification.requestPermission() !== 'granted') throw new Error('notifications refusées dans le navigateur');
  const s = (await subscription()).toJSON();
  const r = await api({ action: 'add', endpoint: s.endpoint, p256dh: s.keys?.p256dh, auth: s.keys?.auth, number });
  const f: Followed = { number, date: r.service_date, seq: r.stop_sequence, stops: r.stops };
  writeFollows([...readFollows().filter((x) => x.number !== number), f]);
  return f;
}

export async function setStop(f: Followed, seq: number): Promise<Followed> {
  const s = (await subscription()).toJSON();
  await api({ action: 'stop', endpoint: s.endpoint, number: f.number, seq });
  const next = { ...f, seq };
  writeFollows(readFollows().map((x) => (x.number === f.number ? next : x)));
  return next;
}

export async function unfollow(number: string): Promise<void> {
  writeFollows(readFollows().filter((x) => x.number !== number));
  const reg = await navigator.serviceWorker.ready;
  const s = await reg.pushManager.getSubscription();
  if (s) await api({ action: 'remove', endpoint: s.endpoint, number });
}
