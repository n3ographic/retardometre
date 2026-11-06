import { COUNT_LABELS } from '../../../lib/counts';
import { curvePoints, dayCell, dowOf, type TrainDay } from '../../../lib/week-charts';
import type { WeekView } from '../../../lib/weekly';

// Graphiques du bilan hebdo : SVG rendus côté serveur, couleurs dans semaine.css (classes wk-c-*).
// Chaque dessin est aria-hidden et doublé d'un texte pour les lecteurs d'écran. Calculs testés dans lib/week-charts.ts.
const fr1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf = (n: number) => n.toLocaleString('fr-FR');
const DOW = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];

const W = 700, H = 200, PAD = 30;
const dayText = (d: WeekView['byDay'][number]) =>
  `${d.label} : ${d.pct === null ? 'aucune mesure' : `${fr1(d.pct)} % (${nf(d.circulated)} trains)`}`;

// Régularité jour par jour : ● jour, ○ moins de 30 trains, ◆ meilleur jour, ⚑ créneau le plus touché, pointillé = semaine.
export function DayCurve({ days, best, slot, mean }: { days: WeekView['byDay']; best: WeekView['bestDay']; slot: WeekView['worstSlot']; mean: number | null }) {
  const c = curvePoints(days, { width: W, height: H, pad: PAD });
  if (c.runs.length === 0) return <p className="term-dim">AUCUNE MESURE CETTE SEMAINE</p>;
  const byDow = new Map(days.map((d) => [dowOf(d.date), d]));
  const flagDow = slot ? slot.dow - 1 : null;
  const flagPoint = flagDow === null ? null : c.points[flagDow];
  return (
    <figure className="wk-curve">
      <svg viewBox={`0 0 ${W} ${H + 20}`} width="100%" aria-hidden="true" focusable="false">
        <text className="wk-c-label" x={2} y={c.yOf(c.yMax) + 4}>{c.yMax}</text>
        <text className="wk-c-label" x={2} y={c.yOf(c.yMin) + 4}>{c.yMin}</text>
        {mean !== null && mean >= c.yMin && mean <= c.yMax && (
          <line className="wk-c-mean" x1={PAD} x2={W - PAD} y1={c.yOf(mean)} y2={c.yOf(mean)}><title>{`Semaine : ${fr1(mean)} %`}</title></line>
        )}
        {c.runs.filter((r) => r.length > 1).map((r) => (
          <polyline key={r[0]} className="wk-c-line" points={r.map((i) => `${c.points[i]!.x},${c.points[i]!.y}`).join(' ')} />
        ))}
        {c.points.map((p, i) => {
          if (!p) return null;
          const d = byDow.get(i)!;
          const isBest = best?.date === d.date;
          return isBest
            ? <polygon key={i} className="wk-c-best" points={`${p.x},${p.y - 8} ${p.x + 8},${p.y} ${p.x},${p.y + 8} ${p.x - 8},${p.y}`}><title>{`Meilleur jour · ${dayText(d)}`}</title></polygon>
            : <circle key={i} className={p.hollow ? 'wk-c-hollow' : 'wk-c-dot'} cx={p.x} cy={p.y} r={5}><title>{dayText(d)}</title></circle>;
        })}
        {slot && flagDow !== null && (
          <text className="wk-c-flag" x={c.xOf(flagDow)} y={(flagPoint?.y ?? PAD) - 12} textAnchor={flagDow > 3 ? 'end' : 'start'}>
            ⚑ {slot.label} · {slot.hour} H · {slot.avg_min}′<title>{`Créneau le plus touché : ${slot.label} ${slot.hour} h, ${slot.avg_min}′ de retard moyen sur ${slot.n} trains`}</title>
          </text>
        )}
        {DOW.map((l, i) => <text key={l} className="wk-c-label" x={c.xOf(i)} y={H + 14} textAnchor="middle">{l}</text>)}
      </svg>
      <ul className="sr-only">
        {days.map((d) => <li key={d.date}>{dayText(d)}{best?.date === d.date ? ', meilleur jour' : ''}</li>)}
        {slot && <li>{`Créneau le plus touché : ${slot.label} ${slot.hour} h, ${slot.avg_min}′ de retard moyen sur ${slot.n} trains`}</li>}
        {mean !== null && <li>{`Régularité de la semaine : ${fr1(mean)} %`}</li>}
      </ul>
    </figure>
  );
}

// Barre horizontale (0 à 100) ; hachurée pour un échantillon faible. Le texte est à côté, dans la page.
export function HBar({ pct, faint = false, label }: { pct: number; faint?: boolean; label: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <svg className="wk-hbar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {faint && <defs><pattern id="wk-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect className="wk-c-bar" width="1.5" height="3" /></pattern></defs>}
      <rect className="wk-c-track" width="100" height="8" />
      <rect className={faint ? undefined : 'wk-c-bar'} fill={faint ? 'url(#wk-hatch)' : undefined} width={w} height="8"><title>{label}</title></rect>
    </svg>
  );
}

const cellText = (d: TrainDay) =>
  `${d.label.toLowerCase()} : ${d.state === 'unobserved' ? 'non observé' : d.state === 'cancelled' ? 'supprimé'
    : d.delay_s === null ? COUNT_LABELS.no_terminus.short.toLowerCase() : d.delay_s < 300 ? 'à l’heure' : `+${Math.round(d.delay_s / 60)}′`}`;

// Train de la semaine : une case par jour, jour, date et retard écrits dedans.
export function TrainDays({ days }: { days: TrainDay[] }) {
  return (
    <ol className="wk-days" aria-label="Retard au terminus jour par jour">
      {days.map((d) => {
        const c = dayCell(d);
        return (
          <li key={d.date} className={c.cls} title={cellText(d)}>
            <span aria-hidden="true" className="wk-d-top">{c.top}</span>
            <span aria-hidden="true" className="wk-d-date">{c.date}</span>
            <span aria-hidden="true" className="wk-d-text">{c.text}</span>
            <span className="sr-only">{cellText(d)}</span>
          </li>
        );
      })}
    </ol>
  );
}
