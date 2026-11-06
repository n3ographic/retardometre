import { expect, test } from 'vitest';
import { createFollowHandler } from '../lib/follow';

const EP = 'https://fcm.googleapis.com/fcm/send/abc';
const calls: [string, Record<string, unknown>][] = [];
const handler = (result: { data: unknown; error: unknown }) => createFollowHandler({
  rpc: async (fn, args) => { calls.push([fn, args]); return result; },
});
const post = (h: ReturnType<typeof handler>, body: unknown) =>
  h(new Request('http://x/api/follow', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

test('suivre : appelle follow_add et renvoie la gare et les arrêts', async () => {
  calls.length = 0;
  const data = { service_date: '2026-11-06', stop_sequence: 4, stops: [[3, 'Poitiers'], [4, 'Bordeaux']] };
  const res = await post(handler({ data, error: null }), { action: 'add', endpoint: EP, p256dh: 'k'.repeat(87), auth: 'a'.repeat(22), number: '8308' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(data);
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(calls).toEqual([['follow_add', { p_endpoint: EP, p_p256dh: 'k'.repeat(87), p_auth: 'a'.repeat(22), p_number: '8308' }]]);
});

test('changer de gare et arrêter : follow_set_stop, follow_remove', async () => {
  calls.length = 0;
  const h = handler({ data: true, error: null });
  expect((await post(h, { action: 'stop', endpoint: EP, number: '8308', seq: 3 })).status).toBe(200);
  expect((await post(h, { action: 'remove', endpoint: EP, number: '8308' })).status).toBe(200);
  expect(calls.map((c) => c[0])).toEqual(['follow_set_stop', 'follow_remove']);
  expect(calls[0][1]).toEqual({ p_endpoint: EP, p_number: '8308', p_seq: 3 });
});

test('requête invalide : 400 sans appel à la base', async () => {
  calls.length = 0;
  const h = handler({ data: null, error: null });
  for (const body of ['pas du json', { action: 'add', endpoint: EP, number: '8308' }, { action: 'boom', endpoint: EP, number: '8308' },
    { action: 'remove', endpoint: EP, number: '83a' }, { action: 'stop', endpoint: EP, number: '8308', seq: 1.5 }, 'x'.repeat(5000)]) {
    expect((await post(h, body)).status).toBe(400);
  }
  expect(calls).toEqual([]);
});

test('refus de la base : codes traduits, erreur inconnue en 502', async () => {
  const add = { action: 'add', endpoint: EP, p256dh: 'k'.repeat(87), auth: 'a'.repeat(22), number: '8308' };
  expect((await post(handler({ data: null, error: { code: '22023' } }), add)).status).toBe(400);
  expect((await post(handler({ data: null, error: { code: 'P0002' } }), add)).status).toBe(404);
  expect((await post(handler({ data: null, error: { code: '54000' } }), add)).status).toBe(429);
  expect((await post(handler({ data: null, error: { code: 'XX000' } }), add)).status).toBe(502);
});
