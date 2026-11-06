'use client';

import { useEffect, useState } from 'react';
import { stationName } from '../../lib/station';
import { follow, pushSupport, readFollows, registerWorker, setStop, unfollow, type Followed, type Support } from '../../lib/push-client';

const Bell = ({ on }: { on: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v3L2 11.5h12L12.5 9V6A4.5 4.5 0 0 0 8 1.5ZM6.2 13a1.8 1.8 0 0 0 3.6 0" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

// Cloche « suivre ce train » : notifications de retard, de suppression et d'arrivée (Web Push), pour le trajet du jour.
// Rien ne s'affiche tant que la clé publique VAPID n'est pas configurée.
export default function FollowBell({ number }: { number: string }) {
  const [support, setSupport] = useState<Support | null>(null);
  const [f, setF] = useState<Followed | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const s = pushSupport();
    setSupport(s);
    setF(readFollows().find((x) => x.number === number) ?? null);
    if (s === 'ok') registerWorker().catch(() => setSupport('unsupported'));
  }, [number]);

  if (support === null || support === 'unsupported') return null;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (e) { setMsg((e as Error).message.toUpperCase()); } finally { setBusy(false); }
  };
  const onClick = () => {
    if (support === 'ios-install') { setMsg('SUR IPHONE : PARTAGER → « SUR L’ÉCRAN D’ACCUEIL », PUIS OUVRIR LE RETARDOMÈTRE DEPUIS L’ICÔNE'); return; }
    run(async () => { if (f) { await unfollow(number); setF(null); } else setF(await follow(number)); });
  };
  const stop = f?.stops.find(([seq]) => seq === f.seq)?.[1];
  return (
    <div className="follow">
      <button type="button" className={`ta-btn${f ? ' on' : ''}`} onClick={onClick} disabled={busy} aria-pressed={Boolean(f)}
        title={f ? 'Arrêter les notifications de ce train' : 'Recevoir une notification en cas de retard et à l’arrivée'}>
        <Bell on={Boolean(f)} /> {busy ? '…' : f ? 'SUIVI' : 'SUIVRE'}
      </button>
      {f && (
        <label className="follow-stop">
          JUSQU’À{' '}
          <select value={f.seq} disabled={busy} onChange={(e) => run(async () => setF(await setStop(f, Number(e.target.value))))}>
            {!f.stops.some(([seq]) => seq === f.seq) && <option value={f.seq}>{stop ?? 'TERMINUS'}</option>}
            {f.stops.map(([seq, name]) => <option key={seq} value={seq}>{stationName(name).toUpperCase()}</option>)}
          </select>
        </label>
      )}
      {msg && <p className="tone-late follow-msg" role="status">{msg}</p>}
    </div>
  );
}
