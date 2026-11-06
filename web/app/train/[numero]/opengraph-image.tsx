import { ImageResponse } from 'next/og';
import { loadTrainProfile } from '../../../lib/handlers';
import { stationName } from '../../../lib/station';
import { supabaseDeps } from '../../../lib/supabase';
import { bucketIndex } from '../../../lib/terminal-model';

// Image de partage (Open Graph) de la fiche : numéro, trajet, score et bande calendrier, aux couleurs du site.
// ImageResponse est fourni par Next : aucune dépendance ajoutée. Police par défaut (pas de monospace embarquée).
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Fiche du train : régularité depuis le début de la collecte';

const BG = '#0a0a0a', AMBER = '#ffb000', DIM = '#b07c00', LINE = '#4a3200';
const SEG = ['#3ad13a', '#ffd24d', '#ffb000', '#ff8c00', '#ff4d4d', '#d12f2f', '#8f1d1d']; // = --seg0…6 de terminal.css

export default async function Image({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  const p = await loadTrainProfile(supabaseDeps, numero).catch(() => null);
  const route = p ? [p.info.origin, p.info.dest].filter((x): x is string => !!x).map(stationName).join(' → ').toUpperCase() : 'TRAIN INCONNU';
  const days = p?.days.slice(-27) ?? []; // 27 derniers jours au plus, sur une ligne
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: BG, color: AMBER, padding: 56, fontSize: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: DIM, fontSize: 26 }}>
          <span style={{ background: AMBER, color: '#000', padding: '0 10px', fontWeight: 700 }}>RETARDOMÈTRE</span>
          <span>OBSERVATOIRE INDÉPENDANT</span>
        </div>
        <div style={{ display: 'flex', marginTop: 48, fontSize: 64, fontWeight: 700 }}>{p ? `${p.info.brand === 'OUIGO' ? 'OUIGO' : 'TGV INOUI'} ${numero}` : `TRAIN ${numero}`}</div>
        <div style={{ display: 'flex', marginTop: 8, fontSize: 34 }}>{route}</div>
        {p && p.score.n > 0 && (
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 48, fontSize: 44 }}>
            À L’HEURE <span style={{ fontSize: 92, fontWeight: 700, margin: '0 18px' }}>{p.score.ok}</span> JOURS SUR
            <span style={{ fontSize: 92, fontWeight: 700, margin: '0 18px' }}>{p.score.n}</span>
            <span style={{ color: DIM, fontSize: 32 }}>RETARD MOYEN {p.score.mean_min?.toLocaleString('fr-FR')} MIN</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
          {days.map((d) => (
            <div key={d.date} style={{
              width: 34, height: 34, display: 'flex',
              background: d.state === 'ran' && d.delay_s !== null ? SEG[bucketIndex(d.delay_s)] : BG,
              border: `2px solid ${d.state === 'cancelled' ? '#8a8a8a' : d.state === 'ran' && d.delay_s !== null ? 'transparent' : LINE}`,
            }} />
          ))}
        </div>
      </div>
    ),
    size,
  );
}
