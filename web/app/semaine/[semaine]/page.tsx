import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { COUNT_KEYS, COUNT_LABELS, breakdownText } from '../../../lib/counts';
import { SAMPLE_MIN, TERMINUS_BUCKETS } from '../../../lib/dashboard-model';
import { loadWeek } from '../../../lib/handlers';
import { supabaseDeps } from '../../../lib/supabase';
import { splitLabel } from '../../../lib/stats';
import { RANGE_HINT, bucketIndex, eurRange } from '../../../lib/terminal-model';
import { axisName, ordinal, shapeWeek, summaryText, weekNum, type WeekView } from '../../../lib/weekly';
import FootBar from '../../terminal/foot-bar';
import StatusBar from '../../terminal/status-bar';
import { DayCurve, HBar, TrainDays } from './charts';
import ShareBar from './share-bar';

// Bilan figé : la base n'est relue qu'une fois par heure et par semaine (cache de loadWeek).
// Tableau de bord de lecture rapide : chiffres clés et courbe en haut, puis axes et causes, grille, train de la semaine.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ semaine: string }> };

const nf = (n: number) => n.toLocaleString('fr-FR');
const fr1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const eur = (n: number) => (n >= 1e6 ? `${fr1(n / 1e6)} M€` : `${nf(Math.round(n / 1000))} k€`);
const STAMP = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const COUNTS_HINT = COUNT_KEYS.map((k) => `${COUNT_LABELS[k].short} : ${COUNT_LABELS[k].long}`).join('\n');

async function load(semaine: string) {
  const r = await loadWeek(supabaseDeps, semaine);
  return r && { view: shapeWeek(r.row, r.prev, r.extra), weeks: r.weeks };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { semaine } = await params;
  const r = await load(semaine).catch(() => null);
  if (!r) return { title: 'Bilan hebdomadaire · Retardomètre' };
  const v = r.view;
  const description = `${v.title} : régularité ${v.kpis.regularity.value === null ? '—' : `${fr1(v.kpis.regularity.value)} %`}, ${eur(v.kpis.cost.value)} HT d’indemnités théoriques, ${nf(v.kpis.trains.value)} TGV.`;
  return { title: `Semaine ${v.num} · Retardomètre`, description, openGraph: { title: `Bilan TGV · semaine ${v.num}`, description } };
}

function Delta({ d, v }: { d: { value: number; unit: '%' | 'PT'; good: boolean } | null; v: WeekView }) {
  if (!d || !v.prev) return null;
  const sign = d.value > 0 ? '+' : d.value < 0 ? '−' : '±';
  return (
    <p className={d.value === 0 ? 'term-dim' : d.good ? 'tone-ontime' : 'tone-severe'}>
      {d.value > 0 ? '▲' : d.value < 0 ? '▼' : '='} {sign}{fr1(Math.abs(d.value))} {d.unit === '%' ? '%' : 'PT'}
      <span className="term-dim"> VS S{v.prev.num}</span>
    </p>
  );
}

export default async function Page({ params }: Props) {
  const { semaine } = await params;
  let r: Awaited<ReturnType<typeof load>>;
  try {
    r = await load(semaine);
  } catch (e) {
    console.error(e);
    return (<><StatusBar /><main className="tp"><p className="mt-warn" role="status">BILAN INDISPONIBLE POUR LE MOMENT, RÉESSAYEZ PLUS TARD.</p></main><FootBar /></>);
  }
  if (!r) notFound();
  const { view: v, weeks } = r;
  const i = weeks.indexOf(v.week);
  const prevWeek = weeks[i - 1], nextWeek = weeks[i + 1];
  const k = v.kpis;
  const range = eurRange(k.cost.low, k.cost.high);
  const maxCause = Math.max(1, ...v.causes.map((c) => c.cost_eur_ht));
  const slot = v.worstSlot;
  return (
    <>
      <StatusBar />
      <main className="tp wk">
        <header className="tp-head wk-head">
          <div>
            <nav className="wk-nav" aria-label="Semaines">
              {prevWeek ? <a href={`/semaine/${prevWeek}`}>← S{weekNum(prevWeek)}</a> : <span className="term-dim">← —</span>}
              <span className="term-dim">BILAN HEBDO</span>
              {/* Dernière semaine figée : la semaine en cours n'a pas de bilan, l'accueil montre les 7 derniers jours en direct. */}
              {nextWeek ? <a href={`/semaine/${nextWeek}`}>S{weekNum(nextWeek)} →</a> : <a href="/" title="Semaine en cours : statistiques des 7 derniers jours sur l’accueil, mises à jour en continu">7 DERNIERS JOURS →</a>}
            </nav>
            <h1><span className="term-logo">SEMAINE {v.num}</span> DU {v.title.split(' DU ')[1]}</h1>
            <p className="term-dim">
              FIGÉ LE {STAMP.format(new Date(v.computed_at)).replace(' ', ' À ')}
              {v.complete ? ' · 7 JOURS' : <> · <span className="tone-late">SEMAINE INCOMPLÈTE · {v.days} JOURS (COLLECTE DEPUIS LE 20/10)</span></>}
            </p>
          </div>
          {/* L'adresse est ajoutée côté navigateur : la même page sert en local et en production. */}
          <ShareBar text={summaryText(v, '').trimEnd()} week={v.week} />
        </header>

        <section className="wk-kpis" aria-label="Chiffres clés">
          <div className="term-panel">
            <h2 className="term-panel-title" title={COUNT_LABELS.circulated.long}>Trains (ont roulé)</h2>
            <p className="wk-big">{nf(k.trains.value)}</p>
            <p className="term-dim wk-small" title={COUNTS_HINT}>{breakdownText(v.counts)}</p>
          </div>
          <div className="term-panel">
            <h2 className="term-panel-title">Régularité</h2>
            <p className="wk-big">{k.regularity.value === null ? '—' : `${fr1(k.regularity.value)} %`}</p>
            <Delta d={k.regularity.delta} v={v} />
            {/* Seuils de regularity_rule (base) : moins de 5′ sous 1 h 30 de trajet, 10′ jusqu'à 3 h, 15′ au-delà. */}
            <p className="term-dim wk-small" title="À l’heure : retard au terminus de moins de 5′ (trajet de moins de 1 h 30), 10′ (jusqu’à 3 h) ou 15′ (au-delà), comme la régularité officielle">À L’HEURE : MOINS DE 5′, 10′ OU 15′ SELON LA DURÉE</p>
            <p className="term-dim wk-small">APPROCHÉE · RETARDS PAR PAS DE 5′</p>
          </div>
          <div className="term-panel">
            <h2 className="term-panel-title">Indemnités HT</h2>
            <p className="wk-big">{eur(k.cost.value)}</p>
            <Delta d={k.cost.delta} v={v} />
            {k.cost.bonShare !== null && <p className="wk-small" title={splitLabel(k.cost.value, k.cost.bon!) ?? undefined}>DONT {k.cost.bonShare} % EN BONS</p>}
            {range && <p className="term-dim wk-small" title={RANGE_HINT}>FOURCHETTE {range}</p>}
          </div>
          <div className="term-panel">
            <h2 className="term-panel-title">Suppressions</h2>
            <p className="wk-big">{k.suppressions.value === null ? '—' : `${fr1(k.suppressions.value)} %`}</p>
            <Delta d={k.suppressions.delta} v={v} />
            <p className="term-dim wk-small">{nf(k.suppressions.n)} TRAINS SUPPRIMÉS</p>
          </div>
        </section>
        {(v.prev?.incomplete || (v.prev && !v.complete)) && <p className="term-dim wk-small">PAS DE COMPARAISON AVEC S{v.prev.num} : {v.prev.incomplete ? `SEMAINE INCOMPLÈTE (${v.prev.days} JOURS)` : 'CETTE SEMAINE EST INCOMPLÈTE'}</p>}
        {v.small && <p className="tone-late">ÉCHANTILLON FAIBLE (MOINS DE 30 TRAINS)</p>}

        <section className="term-panel" aria-labelledby="wk-curve">
          <h2 className="term-panel-title" id="wk-curve">Régularité jour par jour</h2>
          <DayCurve days={v.byDay} best={v.bestDay} slot={slot} mean={k.regularity.value} />
          <p className="term-dim wk-small">● JOUR · ○ MOINS DE 30 TRAINS · ◆ MEILLEUR JOUR · ⚑ CRÉNEAU AU PLUS FORT RETARD MOYEN (CASES D’AU MOINS 5 TRAINS) · POINTILLÉ : SEMAINE</p>
        </section>

        <div className="wk-duo">
          <section className="term-panel" aria-labelledby="wk-axes">
            <h2 className="term-panel-title" id="wk-axes">Axes</h2>
            <div className="wk-scroll">
              <table className="wk-table">
                <thead><tr><th scope="col">Axe</th><th scope="col" colSpan={2}>Régularité</th><th scope="col">Trains</th><th scope="col">Indemn.</th><th scope="col">Par train</th></tr></thead>
                <tbody>
                  {v.axes.map((a) => (
                    <tr key={a.axis}>
                      <th scope="row">{axisName(a.axis)} {a.axis === v.bestAxis ? <span className="tone-ontime" title="Axe le plus régulier">★</span> : a.axis === v.worstAxis ? <span className="tone-severe" title="Axe le moins régulier">▼</span> : ''}</th>
                      <td className="wk-barcell"><HBar pct={a.pct ?? 0} faint={a.small} label={`${axisName(a.axis)} : ${a.pct === null ? 'aucune mesure' : `${fr1(a.pct)} %`}`} /></td>
                      <td>{a.pct === null ? '—' : `${fr1(a.pct)} %`}{a.small && <span className="tone-late"> ÉCHANTILLON FAIBLE</span>}</td>
                      <td>{nf(a.circulated)}</td>
                      <td>{eur(a.cost)}</td>
                      <td>{a.per_train === null ? '—' : `${nf(a.per_train)} €`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="term-dim wk-small">★ LE PLUS RÉGULIER · ▼ LE MOINS RÉGULIER · AXES D’AU MOINS 30 TRAINS · PAR TRAIN : INDEMNITÉS / TRAINS QUI ONT ROULÉ</p>
          </section>

          {v.causes.length > 0 && (
            <section className="term-panel" aria-labelledby="wk-causes">
              <h2 className="term-panel-title" id="wk-causes">Causes (en euros)</h2>
              <ol className="wk-causes">
                {v.causes.map((c) => (
                  <li key={c.category}>
                    <p className="wk-cause-head"><strong>{c.label}</strong> <span>{eur(c.cost_eur_ht)}</span></p>
                    <HBar pct={(c.cost_eur_ht / maxCause) * 100} label={`${c.label} : ${eur(c.cost_eur_ht)}`} />
                    <p className="wk-small">{ordinal(c.trainRank).toUpperCase()} EN NOMBRE ({nf(c.trains)} TRAIN{c.trains > 1 ? 'S' : ''}){c.trains < SAMPLE_MIN && <span className="tone-late"> · ÉCHANTILLON FAIBLE</span>}</p>
                    <p className="term-dim wk-small">{c.sentence}</p>
                  </li>
                ))}
              </ol>
              <p className="term-dim wk-small">CAUSE DÉCLARÉE PAR SNCF · CLASSÉE PAR NOS RÈGLES · TRAINS ≥ 5′</p>
            </section>
          )}
        </div>

        {v.heat[0].cells.length > 0 && (
          <section className="term-panel" aria-labelledby="wk-heat">
            <h2 className="term-panel-title" id="wk-heat">Retard moyen · jour × heure d’arrivée prévue</h2>
            <div className="wk-scroll">
              <table className="wk-heat">
                <thead><tr><th scope="col"><span className="sr-only">Jour</span></th>{v.heat[0].cells.map((c) => <th key={c.hour} scope="col">{String(c.hour).padStart(2, '0')}</th>)}</tr></thead>
                <tbody>
                  {v.heat.map((d, di) => (
                    <tr key={d.label}>
                      <th scope="row">{d.label}</th>
                      {d.cells.map((c) => {
                        const flag = slot !== null && slot.dow === di + 1 && slot.hour === c.hour;
                        const title = c.n === 0 ? `${d.label} ${c.hour} h : aucun train` : `${d.label} ${c.hour} h : ${c.n} train${c.n > 1 ? 's' : ''}, retard moyen ${c.avg_min}′${flag ? ', créneau le plus touché' : ''}`;
                        return <td key={c.hour} title={title} className={`${c.n === 0 ? 'wk-empty' : `tp-s${bucketIndex(c.avg_s!)}${c.n < 5 ? ' wk-faint' : ''}`}${flag ? ' wk-flag' : ''}`}><span className="sr-only">{title}</span></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="term-dim wk-small">
              {TERMINUS_BUCKETS.map((b, j) => <span key={b}><span className={`seg-c s${j}`} aria-hidden="true">█</span> {b} </span>)}MIN · CASE PÂLE : MOINS DE 5 TRAINS · CASE ENTOURÉE : CRÉNEAU ⚑
            </p>
          </section>
        )}

        {v.train && (
          <section className="term-panel" aria-labelledby="wk-train">
            <h2 className="term-panel-title" id="wk-train">Le train de la semaine</h2>
            <p className="tp-big"><a href={`/train/${v.train.number}`}>{v.train.brand === 'OUIGO' ? 'OUIGO' : 'TGV INOUI'} {v.train.number}</a> <span className="wk-route">{v.train.origin ?? '?'} → {v.train.dest ?? '?'}</span></p>
            <TrainDays days={v.train.days} />
            <p>À L’HEURE <strong>{v.train.ok}</strong> JOUR{v.train.ok > 1 ? 'S' : ''} SUR <strong>{v.train.counted}</strong> · {nf(v.train.delay_sum_min)}′ DE RETARD CUMULÉ · AXE {axisName(v.train.axis)}</p>
            <p className="term-dim wk-small">LE MOINS FIABLE DE LA SEMAINE (AU MOINS 4 JOURS OBSERVÉS) · ✓ À L’HEURE (MOINS DE 5′) · × SUPPRIMÉ · – TERMINUS NON DESSERVI · <a href={`/train/${v.train.number}`}>FICHE →</a></p>
          </section>
        )}

        <p className="term-dim wk-small">
          {v.intlCapNote && <>BARÈME INTERNATIONAL PLAFONNÉ À 50 % APPLIQUÉ À PARTIR DU {v.intlCapNote.from} · ÉCART ESTIMÉ SUR CETTE SEMAINE : {nf(Math.round(v.intlCapNote.eur))} €<br /></>}
          RÉGULARITÉ APPROCHÉE (RETARDS PUBLIÉS PAR PAS DE 5′) · INDEMNITÉS THÉORIQUES HT, OCCUPATION {nf(v.occupancy)} · TRAINS OBSERVÉS SEULEMENT · OBSERVATOIRE INDÉPENDANT, NON AFFILIÉ SNCF/OUIGO · <a href="/methodologie">MÉTHODOLOGIE →</a>
        </p>
      </main>
      <FootBar />
    </>
  );
}
