import { COUNT_LABELS } from '../../../lib/counts';
import { dayCell, dowOf, weekSlots, type TrainDay } from '../../../lib/week-charts';
import type { WeekView } from '../../../lib/weekly';

// Graphiques du bilan hebdo, rendus côté serveur, couleurs dans semaine.css.
// Chaque dessin est aria-hidden et doublé d'un texte pour les lecteurs d'écran. Calculs testés dans lib/week-charts.ts.
const fr1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf = (n: number) => n.toLocaleString('fr-FR');
const DOW = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];

const dayText = (d: WeekView['byDay'][number]) =>
  `${d.label} : ${d.pct === null ? 'aucune mesure' : `${fr1(d.pct)} % (${nf(d.circulated)} trains)`}`;

// Régularité jour par jour : barres en HTML/CSS (le texte garde sa taille à toutes les largeurs), échelle de 0 à 100 %,
// meilleur jour en vert, jour de moins de 30 trains hachuré, ⚑ au-dessus du jour du créneau le plus touché,
// pointillé = régularité de la semaine.
export function DayBars({ days, best, slot, mean }: { days: WeekView['byDay']; best: WeekView['bestDay']; slot: WeekView['worstSlot']; mean: number | null }) {
  const cols = weekSlots(days);
  if (cols.every((d) => d === null || d.pct === null)) return <p className="term-dim">AUCUNE MESURE CETTE SEMAINE</p>;
  const flagDow = slot ? slot.dow - 1 : null;
  return (
    <figure className="wk-daybars">
      <div className="wk-db-plot" aria-hidden="true">
        {mean !== null && <div className="wk-db-mean" style={{ bottom: `${mean}%` }} title={`Semaine : ${fr1(mean)} %`} />}
        {cols.map((d, i) => (
          <div key={DOW[i]} className="wk-db-col">
            {slot && flagDow === i && <span className={`wk-db-flag ${i < 2 ? 'at-start' : i > 4 ? 'at-end' : ''}`} title={`Créneau le plus touché : ${slot.label} ${slot.hour} h, ${slot.avg_min}′ de retard moyen sur ${slot.n} trains`}>⚑ {slot.hour} H · {slot.avg_min}′</span>}
            {d?.pct != null && (
              <div className={`wk-db-bar${best?.date === d.date ? ' is-best' : ''}${d.small ? ' is-small' : ''}`} style={{ height: `${d.pct}%` }}
                title={`${best?.date === d.date ? 'Meilleur jour · ' : ''}${dayText(d)}`} />
            )}
          </div>
        ))}
      </div>
      <div className="wk-db-axis" aria-hidden="true">
        {cols.map((d, i) => (
          <div key={DOW[i]}><span className="wk-db-val">{d?.pct != null ? `${fr1(d.pct)} %` : 'n.d.'}</span><span className="wk-db-day">{DOW[i]}</span></div>
        ))}
      </div>
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
