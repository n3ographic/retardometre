import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CAUSE_LABELS } from '../../../lib/causes';
import { COUNT_LABELS } from '../../../lib/counts';
import { TERMINUS_BUCKETS } from '../../../lib/dashboard-model';
import { loadGares, loadTrainProfile } from '../../../lib/handlers';
import { supabaseDeps } from '../../../lib/supabase';
import { bucketIndex, delayTone } from '../../../lib/terminal-model';
import { SMALL_DAYS, todayLabel, type Day, type Profile } from '../../../lib/train-profile';
import FootBar from '../../terminal/foot-bar';
import StatusBar from '../../terminal/status-bar';
import TrainActions from '../../terminal/train-actions';

// Rendue à chaque requête ; la base n'est lue qu'une fois par numéro et par cycle de collecte (cache de loadTrainProfile).
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ numero: string }> };

const HHMM = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const nf = (n: number) => n.toLocaleString('fr-FR');
const brandShort = (b: string) => (b === 'OUIGO' ? 'OUIGO' : 'TGV INOUI');

async function load(numero: string): Promise<Profile | null | 'error'> {
  try {
    return await loadTrainProfile(supabaseDeps, numero);
  } catch (e) {
    console.error(e);
    return 'error';
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { numero } = await params;
  const p = await load(numero);
  if (!p || p === 'error') return { title: `Train ${numero} · Observatoire TGV` };
  const route = [p.info.origin, p.info.dest].filter(Boolean).join(' → ');
  const description = `${brandShort(p.info.brand)} ${numero} ${route} : à l’heure ${p.score.ok} jours sur ${p.score.n} depuis le 20 octobre 2026.`;
  return { title: `Train ${numero} · Observatoire TGV`, description, openGraph: { title: `Train ${numero} · ${route}`, description } };
}

function dayTitle(d: Day): string {
  const date = DAY.format(new Date(`${d.date}T12:00:00Z`));
  if (d.state === 'unobserved') return `${date} · non observé`;
  if (d.state === 'cancelled') return `${date} · supprimé`;
  // train_profile écarte aussi les retards aberrants (≥ 12 h) : les deux cas arrivent ici sans retard.
  if (d.delay_s === null) return `${date} · ${COUNT_LABELS.no_terminus.short.toLowerCase()} ou ${COUNT_LABELS.aberrant.short.toLowerCase()} (écarté)`;
  const cause = d.cause && d.delay_s >= 300 ? ` · ${CAUSE_LABELS[d.cause]?.long ?? d.cause}` : '';
  return `${date} · ${d.delay_s < 300 ? 'à l’heure' : `+${Math.round(d.delay_s / 60)} min`}${cause}`;
}

export default async function Page({ params }: Props) {
  const { numero } = await params;
  const p = await load(numero);
  if (p === null) notFound();
  if (p === 'error') {
    return (<><StatusBar /><main className="tp"><p className="mt-warn" role="status">DONNÉES INDISPONIBLES POUR LE MOMENT, RÉESSAYEZ PLUS TARD.</p></main><FootBar /></>);
  }
  const now = new Date();
  const today = todayLabel(p, now);
  // Origine et destination : lien vers le panneau gare de l'accueil quand le nom est connu (liste des gares en cache 24 h).
  const uicByName = new Map((await loadGares(supabaseDeps).catch(() => [])).map((g) => [g[1], g[0]]));
  const station = (nom: string | null) => {
    const uic = nom ? uicByName.get(nom) : undefined;
    return uic ? <a className="to-marey" href={`/?gare=${uic}`}>{nom}</a> : (nom ?? '?');
  };
  const pct = p.score.n ? Math.round((p.score.ok / p.score.n) * 100) : null;
  const maxStop = Math.max(1, ...p.stops.map((s) => s.avg_min ?? 0));
  const maxCause = Math.max(1, ...p.causes.map((c) => c.days));
  return (
    <>
      <StatusBar />
      <main className="tp">
        <header className="tp-head">
          <h1><span className="term-logo">{brandShort(p.info.brand)} {numero}</span> {station(p.info.origin)} → {station(p.info.dest)}</h1>
          <TrainActions number={numero} current="FICHE" onMap={today.en_route} />
          <p className="term-dim">
            {HHMM.format(new Date(p.info.dep_planned))} → {HHMM.format(new Date(p.info.arr_planned))} (HORAIRE THÉORIQUE) · AXE {p.info.axis.replace('_', '-')}
          </p>
          <p>
            AUJOURD’HUI : <span className={`tone-${delayTone(today.delay_s ?? undefined, p.today?.cancelled ?? false)}`}>{today.text}</span>
          </p>
        </header>

        <section className="term-panel tp-score" aria-labelledby="tp-score">
          <h2 className="term-panel-title" id="tp-score">Fiabilité</h2>
          {p.score.n === 0 ? <p className="term-dim">AUCUN JOUR OBSERVÉ POUR L’INSTANT</p> : (
            <>
              <p className="tp-big">À L’HEURE <strong>{p.score.ok}</strong> JOURS SUR <strong>{p.score.n}</strong> <span className="term-dim">({pct} %)</span></p>
              <p>RETARD MOYEN {p.score.mean_min?.toLocaleString('fr-FR')}′ · MÉDIAN {p.score.median_min?.toLocaleString('fr-FR')}′ · {p.score.n} JOURS OBSERVÉS</p>
              {p.score.small && <p className="tone-late">ÉCHANTILLON FAIBLE (MOINS DE {SMALL_DAYS} JOURS)</p>}
              {p.rank && <p>PLUS FIABLE QUE <strong>{p.rank.better_than_pct} %</strong> DES TRAINS DE SON AXE <span className="term-dim">({p.rank.of} TRAINS)</span></p>}
              <p className="term-dim">À L’HEURE = RETARD PUBLIÉ AU TERMINUS DE MOINS DE 5′ · UNE SUPPRESSION COMPTE COMME UN RETARD</p>
            </>
          )}
        </section>

        <section className="term-panel" aria-labelledby="tp-cal">
          <h2 className="term-panel-title" id="tp-cal">Jour par jour</h2>
          <ol className="tp-cal" aria-label="Retard au terminus par jour de circulation">
            {p.days.map((d) => (
              <li key={d.date} title={dayTitle(d)} aria-label={dayTitle(d)}
                className={d.state === 'unobserved' ? 'tp-unobs' : d.state === 'cancelled' ? 'tp-cancel' : d.delay_s === null ? 'tp-unobs' : `tp-s${bucketIndex(d.delay_s)}`}>
                {d.state === 'cancelled' ? '×' : d.state === 'ran' && d.delay_s === null ? '–' : ''}
              </li>
            ))}
          </ol>
          <p className="term-dim tp-legend">
            {TERMINUS_BUCKETS.map((b, i) => <span key={b}><span className={`seg-c s${i}`} aria-hidden="true">█</span> {b} </span>)}MIN
            · <span className="tp-key tp-unobs" aria-hidden="true" /> NON OBSERVÉ · <span className="tp-key tp-cancel" aria-hidden="true">×</span> SUPPRIMÉ
            · <span className="tp-key tp-unobs" aria-hidden="true">–</span> <span title={COUNT_LABELS.no_terminus.long}>{COUNT_LABELS.no_terminus.short}</span> · DEPUIS LE 20/10
          </p>
        </section>

        <section className="term-panel" aria-labelledby="tp-stops">
          <h2 className="term-panel-title" id="tp-stops">Où il perd du temps</h2>
          {p.stops.length === 0 ? <p className="term-dim">HORAIRE DÉTAILLÉ INDISPONIBLE POUR CE TRAIN</p> : (
            <>
              <table className="tp-stops">
                <caption className="sr-only">Retard moyen publié à chaque gare</caption>
                <thead><tr><th scope="col">Gare</th><th scope="col"><span className="sr-only">Barre</span></th><th scope="col">Moy.</th><th scope="col">Jours</th></tr></thead>
                <tbody>
                  {p.stops.map((s) => (
                    <tr key={s.uic}>
                      <th scope="row">{s.nom.toUpperCase()}</th>
                      <td aria-hidden="true">{s.avg_min !== null && <span className={`tp-bar tp-s${bucketIndex(s.avg_min * 60)}`} style={{ width: `${(s.avg_min / maxStop) * 100}%` }} />}</td>
                      <td>{s.avg_min === null ? '—' : `${s.avg_min.toLocaleString('fr-FR')}′`}</td>
                      <td className="term-dim">{s.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="term-dim">RETARD PUBLIÉ À CHAQUE GARE, MOYENNE DES JOURS OÙ LE TRAIN SUIT SON ITINÉRAIRE ACTUEL · L’HORAIRE DÉTAILLÉ N’EST GARDÉ QUE QUELQUES JOURS</p>
            </>
          )}
        </section>

        <div className="tp-row">
          <section className="term-panel" aria-labelledby="tp-causes">
            <h2 className="term-panel-title" id="tp-causes">Causes</h2>
            {p.causes.length === 0 ? <p className="term-dim">AUCUN RETARD DE 5′ OU PLUS</p> : (
              <ul className="tp-list">
                {p.causes.map((c) => (
                  <li key={c.category} title={CAUSE_LABELS[c.category]?.long}>
                    <span>{CAUSE_LABELS[c.category]?.short ?? c.category.toUpperCase()}</span>
                    <span aria-hidden="true" className="tp-track"><span className="tp-bar tp-amber" style={{ width: `${(c.days / maxCause) * 100}%` }} /></span>
                    <span>{c.days} J</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="term-dim">JOURS AVEC UN RETARD DE 5′ OU PLUS, PAR CAUSE DÉCLARÉE</p>
          </section>
          <section className="term-panel" aria-labelledby="tp-comp">
            <h2 className="term-panel-title" id="tp-comp">Indemnités</h2>
            <p className="tp-big"><strong>{nf(p.comp.eur)} €</strong> <span className="term-dim">HT</span></p>
            <p>{p.comp.days} JOUR{p.comp.days > 1 ? 'S' : ''} AVEC INDEMNITÉ · RÈGLE {p.info.brand}</p>
            <p className="term-dim">THÉORIQUE : % DU BARÈME × PRIX DE RÉFÉRENCE × PLACES × OCCUPATION 0,75 · <a href="/methodologie">MÉTHODE</a></p>
          </section>
        </div>
      </main>
      <FootBar />
    </>
  );
}
