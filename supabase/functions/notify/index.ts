// Notifications Web Push des trains suivis, appelée toutes les 2 min par pg_cron (une minute après collect).
// Lit follow_states, décide avec _shared/follow.ts, envoie, puis enregistre le palier ou efface le suivi.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import { decide, type Decision, type FollowState } from '../_shared/follow.ts'

type Row = FollowState & { id: number; endpoint: string; p256dh: string; auth: string }

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const VAPID = {
  subject: Deno.env.get('VAPID_SUBJECT') ?? '',
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
}
// Flux sans mise à jour depuis 10 min : retards figés, une « arrivée » serait fausse ; rien n'est envoyé.
const STALE_S = 600
const PARALLEL = 20

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// 'ok', 'gone' (abonnement disparu : 404 ou 410) ou le texte de l'erreur.
async function send(r: Row, d: Decision): Promise<string> {
  try {
    const q = webpush.generateRequestDetails(
      { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
      JSON.stringify({ title: d.title, body: d.body, url: `/train/${r.train_number}`, tag: `follow-${r.id}` }),
      // TTL : un retard annoncé plus de 30 min après ne sert plus ; topic : seule la dernière attend un téléphone hors ligne.
      { vapidDetails: VAPID, TTL: 1800, urgency: 'high', topic: `f${r.id}` },
    )
    const res = await fetch(q.endpoint, { method: q.method, headers: q.headers, body: q.body, signal: AbortSignal.timeout(5000) })
    if (res.status === 404 || res.status === 410) return 'gone'
    return res.ok ? 'ok' : `HTTP ${res.status}`
  } catch (e) {
    return (e as Error).message.slice(0, 300)
  }
}

async function handle(r: Row, d: Decision): Promise<'sent' | 'gone' | 'failed'> {
  const res = await send(r, d)
  const follows = db.from('train_follows')
  if (res === 'gone') { await follows.delete().eq('id', r.id); return 'gone' }
  if (res !== 'ok') { await follows.update({ last_error: res }).eq('id', r.id); return 'failed' }
  if (d.next === 'done') await follows.delete().eq('id', r.id)
  // Seulement si l'état n'a pas changé entre-temps (changement de gare, passage concurrent).
  else await follows.update({ last_step: d.next, last_error: null }).eq('id', r.id).eq('last_step', r.last_step)
  return 'sent'
}

Deno.serve(async (req) => {
  const { data: authorized, error: authError } = await db.rpc('collector_secret_ok', {
    candidate: req.headers.get('x-collector-secret') ?? '',
  })
  if (authError) return json({ error: 'vérification du secret impossible' }, 500)
  if (authorized !== true) return json({ error: 'unauthorized' }, 401)
  if (!VAPID.subject || !VAPID.publicKey || !VAPID.privateKey) return json({ error: 'clés VAPID absentes' }, 500)

  const { data: state, error: stateError } = await db.from('collector_state').select('last_feed_ts').eq('id', 1).maybeSingle()
  if (stateError) return json({ error: `collector_state : ${stateError.message}` }, 500)
  if (state?.last_feed_ts == null || Date.now() / 1000 - Number(state.last_feed_ts) > STALE_S) return json({ skipped: 'stale' })

  const { data, error } = await db.rpc('follow_states')
  if (error) return json({ error: `follow_states : ${error.message}` }, 500)
  const todo = (data as Row[]).flatMap((r) => { const d = decide(r); return d ? [{ r, d }] : [] })

  const counts = { sent: 0, gone: 0, failed: 0 }
  for (let i = 0; i < todo.length; i += PARALLEL) {
    for (const k of await Promise.all(todo.slice(i, i + PARALLEL).map(({ r, d }) => handle(r, d)))) counts[k]++
  }
  return json({ follows: (data as Row[]).length, ...counts })
})
