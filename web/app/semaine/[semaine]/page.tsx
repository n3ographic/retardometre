import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CAUSE_LABELS } from '../../../lib/causes';
import { COUNT_KEYS, COUNT_LABELS, breakdownText } from '../../../lib/counts';
import { SAMPLE_MIN, TERMINUS_BUCKETS } from '../../../lib/dashboard-model';
import { loadWeek } from '../../../lib/handlers';
import { supabaseDeps } from '../../../lib/supabase';
import { splitLabel } from '../../../lib/stats';
import { RANGE_HINT, bucketIndex, charBar, eurRange } from '../../../lib/terminal-model';
import { axisName, shapeWeek, summaryText, weekNum, type WeekView } from '../../../lib/weekly';
import FootBar from '../../terminal/foot-bar';
import StatusBar from '../../terminal/status-bar';
import ShareBar from './share-bar';

// Bilan figé : la base n'est relue qu'une fois par heure et par semaine (cache de loadWeek).
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ semaine: string }> };

const nf = (n: number) => n.toLocaleString('fr-FR');
const fr1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const eur = (n: number) => (n >= 1e6 ? `${fr1(n / 1e6)} M€` : `${nf(Math.round(n / 1000))} k€`);
const STAMP = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const COUNTS_HINT = COUNT_KEYS.map((k) => `${COUNT_LABELS[k].short} : ${COUNT_LABELS[k].long}`).join('\n');

async function load(semaine: string) {
  const r = await loadWeek(supabaseDeps, semaine);
  return r && { view: shapeWeek(r.row, r.prev, r.extra), weeks: r.weeks, scale: r.row.payload.scale };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { semaine } = await params;
  const r = await load(semaine).catch(() => null);
  if (!r) return { title: 'Bilan hebdomadaire · Observatoire TGV' };
  const v = r.view;
  const description = `${v.title} : régularité ${v.kpis.regularity.value === null ? '—' : `${fr1(v.kpis.regularity.value)} %`}, ${eur(v.kpis.cost.value)} HT d’indemnités théoriques, ${nf(v.kpis.trains.value)} TGV.`;
  return { title: `Semaine ${v.num} · Observatoire TGV`, description, openGraph: { title: `Bilan TGV · semaine ${v.num}`, description } };
}

function Delta({ d, v }: { d: { value: number; unit: '%' | 'PT'; good: boolean; perDay?: boolean } | null; v: WeekView }) {
  if (!d || !v.prev) return null;
  const sign = d.value > 0 ? '+' : d.value < 0 ? '−' : '±';
  return (
    <p className={d.value === 0 ? 'term-dim' : d.good ? 'tone-ontime' : 'tone-severe'}>
      {d.value > 0 ? '▲' : d.value < 0 ? '▼' : '='} {sign}{fr1(Math.abs(d.value))} {d.unit === '%' ? '%' : 'PT'}{d.perDay ? ' /JOUR' : ''}{v.prev.incomplete ? '*' : ''}
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
  const { view: v, weeks, scale } = r;
  const i = weeks.indexOf(v.week);
  const prevWeek = weeks[i - 1], nextWeek = weeks[i + 1];
  const k = v.kpis;
  const range = eurRange(k.cost.low, k.cost.high);
  const maxCost = Math.max(1, ...v.axes.map((a) => a.cost));
  const maxCause = Math.max(1, ...v.causes.map((c) => c.cost_eur_ht));
  // Seuil d'indemnisation de chaque marque : première tranche du barème figé avec la semaine.
  const threshold = (brand: string) => {
    const s = scale.filter((x) => x.brand === brand && Number(x.pct) > 0).sort((a, b) => Number(a.from_s) - Number(b.from_s))[0];
    return s ? `${Math.round(Number(s.from_s) / 60)}′` : '?';
  };
  return (
    <>
      <StatusBar />
      <main className="tp wk">
        <header className="tp-head">
          <nav className="wk-nav" aria-label="Semaines">
            {prevWeek ? <a href={`/semaine/${prevWeek}`}>← S{weekNum(prevWeek)}</a> : <span className="term-dim">← —</span>}
            <span className="term-dim">BILAN HEBDO</span>
            {nextWeek ? <a href={`/semaine/${nextWeek}`}>S{weekNum(nextWeek)} →</a> : <span className="term-dim">— →</span>}
          </nav>
          <h1><span className="term-logo">SEMAINE {v.num}</span> DU {v.title.split(' DU ')[1]}</h1>
          <p className="term-dim">
            FIGÉ LE {STAMP.format(new Date(v.computed_at)).replace(' ', ' À ')}
            {v.complete ? ' · 7 JOURS' : <> · <span className="tone-late">SEMAINE INCOMPLÈTE · {v.days} JOURS (COLLECTE DEPUIS LE 20/10)</span></>}
          </p>
        </header>

        <section className="wk-kpis" aria-label="Chiffres clés">
          <div className="term-panel">
            <h2 className="term-panel-title" title={COUNT_LABELS.circulated.long}>Trains (ont roulé)</h2>
            <p className="wk-big">{nf(k.trains.value)}</p>
            <Delta d={k.trains.delta} v={v} />
            <p className="term-dim wk-small" title={COUNTS_HINT}>{breakdownText(v.counts)}</p>
          </div>
          <div className="term-panel">
            <h2 className="term-panel-title">Régularité</h2>
            <p className="wk-big">{k.regularity.value === null ? '—' : `${fr1(k.regularity.value)} %`}</p>
            <Delta d={k.regularity.delta} v={v} />
            <p className="term-dim wk-small">APPROCHÉE · RETARDS PAR PAS DE 5′</p>
          </div>
          <div className="term-panel">
            <h2 className="term-panel-title">Indemnités HT</h2>
            <p className="wk-big">{eur(k.cost.value)}</p>
            {k.cost.bon !== null && <p className="wk-small" title={splitLabel(k.cost.value, k.cost.bon) ?? undefined}>DONT {eur(k.cost.bon)} EN BONS</p>}
            <Delta d={k.cost.delta} v={v} />
            {range && <p className="term-dim wk-small" title={RANGE_HINT}>FOURCHETTE {range}</p>}
          </div>
          <div className="term-panel">
            <h2 className="term-panel-title">Suppressions</h2>
            <p className="wk-big">{k.suppressions.value === null ? '—' : `${fr1(k.suppressions.value)} %`}</p>
            <Delta d={k.suppressions.delta} v={v} />
            <p className="term-dim wk-small">{nf(k.suppressions.n)} TRAINS SUPPRIMÉS</p>
          </div>
        </section>
        {v.prev?.incomplete && <p className="term-dim wk-small">* S{v.prev.num} INCOMPLÈTE ({v.prev.days} JOURS) : VOLUMES COMPARÉS PAR JOUR, VARIATIONS À LIRE AVEC PRÉCAUTION</p>}
        {v.small && <p className="tone-late">ÉCHANTILLON FAIBLE (MOINS DE 30 TRAINS)</p>}

        {v.train && (
          <section className="term-panel" aria-labelledby="wk-train">
            <h2 className="term-panel-title" id="wk-train">Le train de la semaine</h2>
            <p className="tp-big"><a href={`/train/${v.train.number}`}>{v.train.brand === 'OUIGO' ? 'OUIGO' : 'TGV INOUI'} {v.train.number}</a> <span className="wk-route">{v.train.origin ?? '?'} → {v.train.dest ?? '?'}</span></p>
            <ol className="tp-cal" aria-label="Retard au terminus par jour">
              {v.train.days.map((d) => {
                const title = `${d.label} · ${d.state === 'unobserved' ? 'non observé' : d.state === 'cancelled' ? 'supprimé' : d.delay_s === null ? COUNT_LABELS.no_terminus.short.toLowerCase() : d.delay_s < 300 ? 'à l’heure' : `+${Math.round(d.delay_s / 60)} min`}`;
                return (
                  <li key={d.date} title={title} aria-label={title}
                    className={d.state === 'unobserved' ? 'tp-unobs' : d.state === 'cancelled' ? 'tp-cancel' : d.delay_s === null ? 'tp-unobs' : `tp-s${bucketIndex(d.delay_s)}`}>
                    {d.state === 'cancelled' ? '×' : d.state === 'ran' && d.delay_s === null ? '–' : ''}
                  </li>
                );
              })}
            </ol>
            <p>À L’HEURE <strong>{v.train.ok}</strong> JOUR{v.train.ok > 1 ? 'S' : ''} SUR <strong>{v.train.counted}</strong> · {nf(v.train.delay_sum_min)}′ DE RETARD CUMULÉ · AXE {axisName(v.train.axis)}</p>
            <p className="term-dim">LE MOINS FIABLE DE LA SEMAINE (AU MOINS 4 JOURS OBSERVÉS) · <a href={`/train/${v.train.number}`}>FICHE →</a></p>
          </section>
        )}

        <div className="tp-row">
          {([['Pire jour', v.worstDay], ['Meilleur jour', v.bestDay]] as const).map(([label, d]) => (
            <section key={label} className="term-panel">
              <h2 className="term-panel-title">{label}</h2>
              {!d ? <p className="term-dim">—</p> : (
                <>
                  <p className="tp-big">{d.label} · <strong>{fr1(d.pct!)} %</strong></p>
                  <p className="term-dim">{nf(d.circulated)} TRAINS · CAUSE LA PLUS CITÉE : {d.cause ? CAUSE_LABELS[d.cause]?.short ?? d.cause.toUpperCase() : '—'}</p>
                </>
              )}
            </section>
          ))}
        </div>

        <section className="term-panel" aria-labelledby="wk-axes">
          <h2 className="term-panel-title" id="wk-axes">Axes</h2>
          <div className="wk-scroll">
          <table className="wk-table">
            <thead><tr><th scope="col">Axe</th><th scope="col" colSpan={2}>Régularité</th><th scope="col" colSpan={2}>Indemnités HT</th></tr></thead>
            <tbody>
              {v.axes.map((a) => (
                <tr key={a.axis} className={a.small ? 'term-small' : undefined}>
                  <th scope="row">{axisName(a.axis)} {a.axis === v.bestAxis ? <span className="tone-ontime" title="Axe le plus régulier">★</span> : a.axis === v.worstAxis ? <span className="tone-severe" title="Axe le moins régulier">▼</span> : ''}</th>
                  <td className="wk-bar" aria-hidden="true">{charBar(a.pct, 12)}</td>
                  <td>{a.pct === null ? '—' : `${fr1(a.pct)} %`}{a.small && <span className="tone-late"> ÉCHANTILLON FAIBLE</span>}</td>
                  <td className="wk-bar" aria-hidden="true">{charBar((a.cost / maxCost) * 100, 12)}</td>
                  <td>{eur(a.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="term-dim wk-small">★ LE PLUS RÉGULIER · ▼ LE MOINS RÉGULIER · AXES D’AU MOINS 30 TRAINS</p>
        </section>

        {v.causes.length > 0 && (
          <section className="term-panel" aria-labelledby="wk-causes">
            <h2 className="term-panel-title" id="wk-causes">Causes (en euros)</h2>
            <ol className="wk-causes">
              {v.causes.map((c) => (
                <li key={c.category}>
                  <p><strong>{c.label}</strong> <span className="wk-bar" aria-hidden="true">{charBar((c.cost_eur_ht / maxCause) * 100, 16)}</span> {eur(c.cost_eur_ht)}{c.trains < SAMPLE_MIN && <span className="tone-late"> · ÉCHANTILLON FAIBLE</span>}</p>
                  <p className="term-dim">{c.sentence}</p>
                </li>
              ))}
            </ol>
            <p className="term-dim wk-small">CAUSE DÉCLARÉE PAR SNCF · CLASSÉE PAR NOS RÈGLES · TRAINS ≥ 5′</p>
          </section>
        )}

        {v.heat[0].cells.length > 0 && (
          <section className="term-panel" aria-labelledby="wk-heat">
            <h2 className="term-panel-title" id="wk-heat">Retard moyen · jour × heure d’arrivée prévue</h2>
            <div className="wk-scroll">
              <table className="wk-heat">
                <thead><tr><th scope="col"><span className="sr-only">Jour</span></th>{v.heat[0].cells.map((c) => <th key={c.hour} scope="col">{String(c.hour).padStart(2, '0')}</th>)}</tr></thead>
                <tbody>
                  {v.heat.map((d) => (
                    <tr key={d.label}>
                      <th scope="row">{d.label}</th>
                      {d.cells.map((c) => {
                        const title = c.n === 0 ? `${d.label} ${c.hour} h : aucun train` : `${d.label} ${c.hour} h : ${c.n} trains, retard moyen ${c.avg_min}′`;
                        return <td key={c.hour} title={title} className={c.n === 0 ? 'wk-empty' : `tp-s${bucketIndex(c.avg_s!)}${c.n < 5 ? ' wk-faint' : ''}`}><span className="sr-only">{title}</span></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="term-dim wk-small">
              {TERMINUS_BUCKETS.map((b, j) => <span key={b}><span className={`seg-c s${j}`} aria-hidden="true">█</span> {b} </span>)}MIN · CASE PÂLE : MOINS DE 5 TRAINS
            </p>
          </section>
        )}

        {v.brands.length > 0 && (
          <section className="term-panel" aria-labelledby="wk-brands">
            <h2 className="term-panel-title" id="wk-brands">INOUI / OUIGO</h2>
            <dl className="brand-split">
              {v.brands.map((b) => (
                <div key={b.brand} className={b.small ? 'term-small' : undefined}>
                  <dt className={`brand-${b.brand.toLowerCase()}`}>{b.brand}</dt>
                  <dd>{nf(b.circulated)} TR · RÉGUL. {b.pct === null ? '—' : `${fr1(b.pct)} %`} · {b.cost_share} % DES INDEMNITÉS{b.small ? ' · ÉCHANTILLON FAIBLE' : ''}</dd>
                </div>
              ))}
            </dl>
            <p className="term-dim wk-small">BARÈMES DIFFÉRENTS : INDEMNITÉ POUR UN RETARD D’AU MOINS {threshold('INOUI')} EN INOUI, {threshold('OUIGO')} EN OUIGO · <a href="/methodologie">DÉTAIL →</a></p>
          </section>
        )}

        {v.takeaways.length > 0 && (
          <section className="term-panel" aria-labelledby="wk-keys">
            <h2 className="term-panel-title" id="wk-keys">À retenir</h2>
            <ul className="wk-keys">{v.takeaways.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>
        )}
        {/* L'adresse est ajoutée côté navigateur : la même page sert en local et en production. */}
        <ShareBar text={summaryText(v, '').trimEnd()} week={v.week} />

        <p className="term-dim wk-small">
          {v.intlCapNote && <>BARÈME INTERNATIONAL PLAFONNÉ À 50 % APPLIQUÉ À PARTIR DU {v.intlCapNote.from} · ÉCART ESTIMÉ SUR CETTE SEMAINE : {nf(Math.round(v.intlCapNote.eur))} €<br /></>}
          RÉGULARITÉ APPROCHÉE (RETARDS PUBLIÉS PAR PAS DE 5′) · INDEMNITÉS THÉORIQUES HT, OCCUPATION {nf(v.occupancy)} · TRAINS OBSERVÉS SEULEMENT · OBSERVATOIRE INDÉPENDANT, NON AFFILIÉ SNCF/OUIGO · <a href="/methodologie">MÉTHODOLOGIE →</a>
        </p>
      </main>
      <FootBar />
    </>
  );
}
