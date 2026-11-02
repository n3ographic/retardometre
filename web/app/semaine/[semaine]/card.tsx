import { ImageResponse } from 'next/og';
import { loadWeek } from '../../../lib/handlers';
import { supabaseDeps } from '../../../lib/supabase';
import { bucketIndex } from '../../../lib/terminal-model';
import { shapeWeek } from '../../../lib/weekly';

// Visuel de partage du bilan (Open Graph 1200×630 et carré 1080×1080), aux couleurs de /train/[numero]/opengraph-image.
// ImageResponse est fourni par Next : aucune dépendance ajoutée.
const BG = '#0a0a0a', AMBER = '#ffb000', DIM = '#b07c00', LINE = '#4a3200', GOOD = '#3ad13a', BAD = '#ff4d4d';
const SEG = ['#3ad13a', '#ffd24d', '#ffb000', '#ff8c00', '#ff4d4d', '#d12f2f', '#8f1d1d']; // = --seg0…6 de terminal.css
const fr1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf = (n: number) => n.toLocaleString('fr-FR');

export async function weekCard(semaine: string, size: { width: number; height: number }) {
  const r = await loadWeek(supabaseDeps, semaine).catch(() => null);
  if (!r) return null; // semaine non calculée (ou base indisponible) : l'appelant répond 404
  const v = shapeWeek(r.row, r.prev);
  const square = size.width === size.height;
  const big = square ? 120 : 96;
  const d = v.kpis.regularity.delta;
  const cost = v.kpis.cost.value >= 1e6 ? `${fr1(v.kpis.cost.value / 1e6)} M€` : `${nf(Math.round(v.kpis.cost.value / 1000))} k€`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: BG, color: AMBER, padding: 56, fontSize: 30 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: DIM, fontSize: 26 }}>
          <span style={{ background: AMBER, color: '#000', padding: '0 10px', fontWeight: 700 }}>OBS·TGV</span>
          <span>BILAN HEBDO · INDÉPENDANT</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 36 }}>
            <span style={{ fontSize: 72, fontWeight: 700 }}>SEMAINE {v.num}</span>
            <span style={{ marginLeft: 24, color: DIM }}>{v.title.split(' · ')[1]}{v.complete ? '' : ` · ${v.days} JOURS`}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: square ? 'column' : 'row', gap: square ? 24 : 64, marginTop: 40 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ color: DIM, fontSize: 26 }}>RÉGULARITÉ</span>
              <span style={{ fontSize: big, fontWeight: 700, lineHeight: 1 }}>{v.kpis.regularity.value === null ? '—' : `${fr1(v.kpis.regularity.value)} %`}</span>
              {d && v.prev && <span style={{ color: d.good ? GOOD : BAD, fontSize: 26 }}>{/* police par défaut sans ▲ ▼ : signe et couleur seulement */}{d.value >= 0 ? '+' : '−'}{fr1(Math.abs(d.value))} PT VS S{v.prev.num}{v.prev.incomplete ? ' (INCOMPLÈTE)' : ''}</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ color: DIM, fontSize: 26 }}>INDEMNITÉS THÉORIQUES HT</span>
              <span style={{ fontSize: big, fontWeight: 700, lineHeight: 1 }}>{cost}</span>
              <span style={{ color: DIM, fontSize: 26 }}>{nf(v.kpis.trains.value)} TGV OBSERVÉS QUI ONT ROULÉ</span>
            </div>
          </div>
          {v.train && (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
              <span style={{ color: DIM, fontSize: 24 }}>TRAIN DE LA SEMAINE · À L’HEURE {v.train.ok} JOUR{v.train.ok > 1 ? 'S' : ''} SUR {v.train.counted}</span>
              <span style={{ fontSize: 34, marginTop: 4 }}>{v.train.number} {(v.train.origin ?? '?').toUpperCase()} → {(v.train.dest ?? '?').toUpperCase()}</span>
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                {v.train.days.map((x) => (
                  <div key={x.date} style={{
                    width: 34, height: 34, display: 'flex',
                    background: x.state === 'ran' && x.delay_s !== null ? SEG[bucketIndex(x.delay_s)] : BG,
                    border: `2px solid ${x.state === 'cancelled' ? '#8a8a8a' : x.state === 'ran' && x.delay_s !== null ? 'transparent' : LINE}`,
                  }} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
