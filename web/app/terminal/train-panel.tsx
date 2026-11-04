import { TERMINUS_BUCKETS } from '../../lib/dashboard-model';
import { isStale, type LiveItem } from '../../lib/map-model';
import TrainActions from './train-actions';
import CauseText from './cause-text';
import { bucketIndex, delayTone } from '../../lib/terminal-model';
import { estimatePosition, segmentProgress } from '../../lib/position';
import { compensationView, delayBounds, observedAgo, speedView, thresholdProgress, type Rules } from '../../lib/train-card';
import { ruleLabel } from '../../lib/stats';

const at = (stop?: string) => (!stop ? '' : /^[AEIOUYÂÉÈÊÎÔ]/i.test(stop) ? ` D’${stop.toUpperCase()}` : ` DE ${stop.toUpperCase()}`);
const eur = (n: number) => n.toFixed(2).replace('.', ',');
const range = (lo: number, hi: number, fmt: (n: number) => string) => (lo === hi ? fmt(hi) : `${fmt(lo)} À ${fmt(hi)}`);
const METER_W = 20;
const meter = (ratio: number) => { const n = Math.round(Math.min(Math.max(ratio, 0), 1) * METER_W); return '█'.repeat(n) + '░'.repeat(METER_W - n); };
const TONE_LABELS = { ontime: 'À L’HEURE', late: 'RETARD', strong: 'FORT RETARD', severe: 'TRÈS FORT RETARD', cancelled: 'ANNULÉ' } as const;

// Fiche du train sélectionné : volet posé sur le côté de la carte (la carte reste visible et cliquable à gauche).
export default function TrainPanel({ train: t, missing, gareOf, onGare, rules, speed, onClose }: {
  train: LiveItem | null; missing: string | null; gareOf: (nom: string) => string | null; onGare: (uic: string) => void;
  rules: Rules | null; speed: number | null; onClose: () => void;
}) {
  const now = new Date();
  // Origine ou destination connue de la liste des gares : un clic ouvre son panneau gare.
  const station = (nom: string) => {
    const uic = gareOf(nom);
    return uic ? <button type="button" className="to-gare" onClick={() => onGare(uic)} title={`Départs et arrivées : ${nom}`}>{nom}</button> : nom;
  };
  const shell = (title: string, body: React.ReactNode) => (
    <aside className="train-modal" role="dialog" aria-label={`Fiche du train ${title}`}>
      <header><h2 className="term-panel-title">{title}</h2><button type="button" className="term-btn" onClick={onClose} aria-label="Fermer la fiche">×</button></header>
      {body}
    </aside>
  );
  if (!t && missing) return shell(`TRAIN ${missing}`, (
    <>
      <TrainActions number={missing} current="CARTE" onMap={false} />
      <p className="tone-late">PAS EN CIRCULATION</p>
    </>
  ));
  if (!t) return shell('TRAIN', <p className="term-dim">TRAIN TERMINÉ OU HORS DU FLUX</p>);

  const tone = delayTone(t.delay_s, t.cancelled);
  const delay = Math.max(t.delay_s ?? 0, 0);
  const b = delayBounds(delay);
  const idx = bucketIndex(t.delay_s);
  const cv = !t.cancelled && rules ? compensationView(t.brand, t.delay_s, rules, t.intl) : null;
  const prog = !t.cancelled && rules ? thresholdProgress(t.brand, t.delay_s, rules, t.intl) : null;
  const ago = observedAgo(t.last_seen_at, now);
  const sv = speedView(speed, segmentProgress(t, now));
  const onMap = estimatePosition(t, now) !== null;
  return shell(`${t.brand} ${t.train_number}`, (
    <>
      {t.origin && t.dest && <p>{station(t.origin)} → {station(t.dest)}</p>}
      <TrainActions number={t.train_number} current="CARTE" onMap={onMap} />
      {!onMap && <p className="tone-late">PAS EN CIRCULATION</p>}
      <section className="train-block">
        <h3>Retard</h3>
        <p className={`train-big tone-${tone}`}>{tone === 'cancelled' ? 'ANNULÉ' : tone === 'ontime' ? 'À L’HEURE' : `+${Math.round(delay / 60)}′`}</p>
        {tone !== 'cancelled' && (
          <>
            <p className="term-dim">{TONE_LABELS[tone]} · RÉEL ENTRE {Math.round(b.low_s / 60)}′ ET {Math.round(b.high_s / 60)}′</p>
            <p className="meter" aria-label={`Tranche de retard ${TERMINUS_BUCKETS[idx]} minutes`}>
              {TERMINUS_BUCKETS.map((bk, i) => <span key={bk} className={`seg-c s${i}`} aria-hidden="true">{i <= idx ? '██' : '░░'}</span>)}
            </p>
          </>
        )}
      </section>
      {(cv || prog) && (
        <section className="train-block">
          <h3>Indemnité théorique <span className="term-dim" title={t.brand === 'OUIGO' ? 'OUIGO : 25 % dès 1 h, 50 % dès 2 h, en bon convertible en virement' : t.intl ? 'G30 international : 25 % dès 30 min, 50 % dès 2 h (plafond) ; bon d’achat jusqu’à 1 h, argent au-delà' : 'G30 national : 25 % dès 30 min, 50 % dès 2 h, 75 % au-delà de 3 h ; bon d’achat jusqu’à 1 h, argent au-delà'}>· {ruleLabel(t.brand, t.intl)}</span></h3>
          {cv && (cv.pct_high > 0
            ? <p><span className="train-big">{range(cv.pct_low, cv.pct_high, (n) => `${n} %`)}</span> · {range(cv.eur_low, cv.eur_high, eur)} € / VOYAGEUR HT{cv.form && <> · {cv.form}</>}</p>
            : <p className="term-dim">AUCUNE AU RETARD ACTUEL</p>)}
          {prog && cv?.next && (
            <>
              <p className="meter" aria-hidden="true">{meter(prog.ratio)}</p>
              <p className="term-dim">PROCHAIN SEUIL : {cv.next.pct} % À +{Math.round(prog.to_s / 60)}′ (DANS {Math.ceil(cv.next.in_s / 60)}′)</p>
            </>
          )}
        </section>
      )}
      <section className="train-block">
        <h3>Mesure</h3>
        <p>VITESSE {sv.kind === 'none' ? <span className="term-dim">— (À L’ARRÊT OU INCONNUE)</span> : sv.kind === 'approach' ? <span className="term-dim">— (EN APPROCHE{at(sv.stop)})</span> : sv.kind === 'departure' ? <span className="term-dim">— (AU DÉPART{at(sv.stop)})</span> : sv.kind === 'short' ? <span className="term-dim">— (TRONÇON COURT, MOYENNE NON SIGNIFICATIVE)</span> : <>≈ {sv.kmh} KM/H <span className="term-dim">PRÉVUS SUR LE TRONÇON{sv.rising ? ' · RETARD EN HAUSSE' : ''}</span></>}</p>
        <p>OBSERVÉ {ago === null ? '—' : ago === 0 ? 'À L’INSTANT' : `IL Y A ${ago} MIN`} <span className="term-dim">· POSITION ESTIMÉE</span></p>
        {isStale(t, now) && <p className="tone-late">DONNÉE PÉRIMÉE : TRAIN NON VU RÉCEMMENT</p>}
      </section>
      {t.cause && (
        <section className="train-block">
          <h3>Cause</h3>
          <p className="train-cause"><CauseText text={t.cause} /></p>
        </section>
      )}
    </>
  ));
}
