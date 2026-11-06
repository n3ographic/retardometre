import { COUNT_LABELS } from '../../../lib/counts';
import { dayCell, dowOf, lateBars, lateHeadline, type TrainDay } from '../../../lib/week-charts';
import type { WeekView } from '../../../lib/weekly';

// Graphiques du bilan hebdo, rendus côté serveur, couleurs dans semaine.css.
// Chaque dessin est aria-hidden et doublé d'un texte pour les lecteurs d'écran. Calculs testés dans lib/week-charts.ts.
const fr1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf = (n: number) => n.toLocaleString('fr-FR');
const DOW = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];

const DOW_LONG = ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE'];

// Trains en retard jour par jour : phrase titre sur le pire jour, une barre par jour (échelle depuis 0), pire jour en rouge,
// jour de moins de 30 trains hachuré. Barres en HTML/CSS : le texte garde sa taille à toutes les largeurs.
export function LateBars({ days }: { days: WeekView['byDay'] }) {
  const b = lateBars(days);
  if (b.slots.every((s) => s === null)) return <p className="term-dim">AUCUNE MESURE CETTE SEMAINE</p>;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const worst = b.slots.find((s) => s?.date === b.worst) ?? null;
  const text = (s: NonNullable<(typeof b.slots)[number]>) =>
    `${byDate.get(s.date)!.label} : ${fr1(s.late)} % en retard (${nf(byDate.get(s.date)!.circulated)} trains)`;
  return (
    <figure className="wk-daybars">
      {worst && <p className="wk-db-head">{DOW_LONG[dowOf(worst.date)]} : {lateHeadline(worst.late)}, LE PIRE JOUR DE LA SEMAINE</p>}
      <div className="wk-db-plot" aria-hidden="true">
        {b.slots.map((s, i) => (
          <div key={DOW[i]} className="wk-db-col">
            {s && <div className={`wk-db-bar${s.date === b.worst ? ' is-worst' : ''}${s.small ? ' is-small' : ''}`} style={{ height: `${s.height}%` }} title={text(s)} />}
          </div>
        ))}
      </div>
      <div className="wk-db-axis" aria-hidden="true">
        {b.slots.map((s, i) => (
          <div key={DOW[i]}><span className={`wk-db-val${s?.date === b.worst ? ' tone-severe' : ''}`}>{s ? `${fr1(s.late)} %` : 'n.d.'}</span><span className="wk-db-day">{DOW[i]}</span></div>
        ))}
      </div>
      <ul className="sr-only">
        {b.slots.map((s) => s && <li key={s.date}>{text(s)}{s.date === b.worst ? ', pire jour' : ''}</li>)}
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
          <li key={d.date} className={c.cls} title={cellText(d)} style={{ gridColumnStart: dowOf(d.date) + 1 }}>
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
