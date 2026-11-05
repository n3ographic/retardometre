import { supabaseDeps } from '../../lib/supabase';
import { loadRules, type Rules } from '../../lib/rules';
import FootBar from '../terminal/foot-bar';
import StatusBar from '../terminal/status-bar';
import { CAUSE_LABELS } from '../../lib/causes';
import { COUNT_KEYS, COUNT_LABELS } from '../../lib/counts';
import { Fragment } from 'react';

export const metadata = { title: 'Méthodologie · Observatoire TGV' };
// Rendue à chaque requête : un build sans accès à la base ne doit pas figer « règles indisponibles ».
// La base n'est lue qu'une fois par heure (cache de données de loadRules).
export const dynamic = 'force-dynamic';

const nf = (n: number) => n.toLocaleString('fr-FR');
const fmtDate = (iso: string) => iso.split('-').reverse().join('/');
const fmtMin = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${nf(m)} min`);
// 5 400 s = 1 h 30 ; 10 801 s = « plus de 3 h » (la base stocke un seuil exclusif à la seconde près).
function fmtDuration(s: number): string {
  if (s % 60 === 1) return `plus de ${fmtDuration(s - 1)}`;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}
// Tranche de durée prévue : le seuil suivant (exclusif à la seconde près) borne la tranche.
function durationBand(from: number[], i: number): string {
  if (from.length === 1) return 'toutes durées';
  if (i === 0) return `moins de ${fmtDuration(from[1])}`;
  if (i === from.length - 1) return `plus de ${fmtDuration(from[i] - 1)}`;
  return `de ${fmtDuration(from[i])} à ${fmtDuration(from[i + 1] - 1)}`;
}
const RELEASES = 'https://github.com/n3ographic/sncf-tracking/releases';
const REPO = 'https://github.com/n3ographic/sncf-tracking';

function Unavailable() {
  return <p className="mt-warn" role="status">Règles indisponibles pour le moment, réessayez plus tard.</p>;
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} rel="noopener noreferrer">{children}</a>;
}

export default async function Page() {
  let rules: Rules | null = null;
  try {
    rules = await loadRules(supabaseDeps);
  } catch (e) {
    console.error(e);
  }
  const scales = rules
    ? [...new Map(rules.compensation_scale.map((s) => [`${s.brand}-${s.scope ?? 'national'}`, { brand: s.brand, scope: s.scope ?? 'national' }])).values()]
    : [];

  return (
    <>
    <StatusBar />
    <main className="mt">
      <h1 className="term-h1">Méthodologie</h1>

      <section>
        <h2>Sources et licence</h2>
        <ul>
          <li>Flux GTFS temps réel de la SNCF (Trip Updates et Service Alertes), via <Link href="https://transport.data.gouv.fr">transport.data.gouv.fr</Link>.</li>
          <li>GTFS statique SNCF (SNCF Open Data) pour les horaires théoriques.</li>
          <li>Fichier de formes des lignes du Réseau Ferré National, SNCF Réseau, pour les tracés de la carte. Pour les paires d'arrêts que ce fichier ne couvre pas (gares étrangères, interconnexion de Marne-la-Vallée, quelques lignes régionales), tracés de <Link href="https://trainnomade.fr/donnees/">Train Nomade</Link>, d'après © contributeurs OpenStreetMap.</li>
          <li><Link href="https://www.data.gouv.fr/datasets/vitesse-maximale-nominale-sur-ligne">Vitesse maximale nominale sur ligne</Link> (SNCF Réseau, data.gouv.fr) pour le calque VMAX de la carte.</li>
          <li><Link href="https://www.data.gouv.fr/datasets/regularite-mensuelle-tgv-par-liaisons">Régularité mensuelle TGV par liaisons</Link> (SNCF, data.gouv.fr) pour la définition de la régularité officielle.</li>
        </ul>
        <p>Ces données sont sous licence ODbL 1.0. Contient des informations de SNCF Open Data, de SNCF Réseau, de Train Nomade, des contributeurs OpenStreetMap et de transport.data.gouv.fr, sous licence ODbL.
          Observatoire indépendant, non affilié à SNCF ni à OUIGO.</p>
      </section>

      <section>
        <h2>Périmètre</h2>
        <p>Les TGV INOUI et les OUIGO TGV. Les OUIGO Train Classique (numéros 4000 à 4999) sont exclus.
          Seuls les trains que le flux temps réel publie sont mesurés : la collecte tourne toutes les 2 minutes depuis le 20 octobre 2026.</p>
      </section>

      <section>
        <h2>Définitions</h2>
        <dl>
          <dt>Train</dt><dd>Un train est identifié par son numéro et son jour de service ; les variantes de l’horaire créées par les réimports ne comptent qu’une fois (la circulation retenue est la plus récemment vue).</dd>
          <dt>Prévu</dt><dd>Train du plan de transport (GTFS statique) pour un jour de service.</dd>
          <dt>Jamais observé, retiré tard</dt><dd>Jamais observé : prévu mais jamais vu (collecte absente ou train non publié). Retiré tard : retiré du plan après avoir été prévu.</dd>
          <dt>Observés depuis le 20/10 (couverture)</dt><dd>Part des trains prévus (un par numéro et par jour, trains terminés depuis le 20 octobre 2026) qui ont été observés dans le flux temps réel ; c’est la couverture du compteur cumulé, affichée dans la barre d’état (« OBS. DEPUIS 20/10 ») et sous le compteur (« % DU PRÉVU »).</dd>
        </dl>
        <h3>Comptage des trains observés</h3>
        <p>Chaque train observé et terminé entre dans une seule des quatre catégories qui suivent « OBSERVÉS » ci-dessous ; leur somme fait le total des observés.
          Ces libellés sont les mêmes sur l’accueil, les bilans et les fiches de train.</p>
        <dl>
          {COUNT_KEYS.map((k) => <Fragment key={k}><dt>{COUNT_LABELS[k].short}</dt><dd>{COUNT_LABELS[k].long}.</dd></Fragment>)}
        </dl>
        <p>Seuls les trains qui <strong>ont roulé</strong> entrent dans la régularité, les tranches de retard et les indemnités : c’est l’effectif de tous les pourcentages.
          Les suppressions sont comptées à part (taux de suppression). Les trains au terminus non desservi n’ont pas de retard final mesurable et sont exclus de la régularité ;
          dans les faits, ce sont des parcours limités (terminus supprimé), souvent lors de perturbations importantes : leur exclusion rend la régularité un peu plus favorable que la réalité vécue.</p>
        <h3>Régularité officielle</h3>
        <p>Un train est à l’heure si son retard au terminus est <strong>strictement inférieur</strong> à un seuil qui dépend de la durée prévue du trajet.
          Taux = trains à l’heure / trains ayant circulé ; les suppressions sont exclues du dénominateur, comme dans la mesure officielle.</p>
        {rules ? (
          <div className="mt-scroll">
            <table>
              <caption>Seuils de régularité (lus dans la base)</caption>
              <thead><tr><th scope="col">Durée prévue</th><th scope="col">Retard toléré (strictement inférieur à)</th><th scope="col">Source</th></tr></thead>
              <tbody>
                {rules.regularity_rule.map((r, i, all) => (
                  <tr key={r.duration_from_s}>
                    <th scope="row">{durationBand(all.map((x) => x.duration_from_s), i)}</th>
                    <td>{fmtMin(r.max_delay_exclusive_s / 60)}</td>
                    <td><Link href={r.source_url}>source</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Unavailable />}
        <h3>Mesure brute</h3>
        <p>Les suppressions comptent comme des échecs. Le retard est réparti en sept tranches (0-4, 5-14, 15-29, 30-59, 60-119, 120-179, 180 min et plus ; le flux publiant les retards par pas de 5 minutes, 0 et 1-4 sont réunies), au terminus et à chaque arrêt ; les arrêts supprimés sont comptés à part.
          Les tranches s’alignent sur les seuils d’indemnisation.</p>
      </section>

      <section id="indemnites">
        <h2>Indemnités théoriques</h2>
        <p>Pourcentage du billet dû selon le retard à l’arrivée, appliqué à un prix de référence et à un nombre de voyageurs estimé :
          coût = pourcentage × prix de référence × places × occupation.</p>
        <p>Les deux marques n’ont <strong>pas le même barème</strong>, c’est voulu. Trois règles s’appliquent, selon le train :</p>
        <ul>
          <li><strong>G30 national</strong> (TGV INOUI) : 25 % dès 30 minutes, 50 % de 2 à 3 heures, 75 % au-delà de 3 heures, quel que soit le motif du retard.</li>
          <li><strong>G30 international</strong> (TGV INOUI dont la gare d’origine ou de destination est hors de France) : 25 % dès 30 minutes, 50 % à partir de 2 heures, <strong>plafonné à 50 %</strong>.</li>
          <li><strong>OUIGO</strong> : 25 % de 60 à 119 minutes, 50 % à partir de 120 minutes.</li>
        </ul>
        <p><strong>Seuil de 30 minutes.</strong> Le tableau du barème de SNCF Connect indique « Entre 30 min et 2h : 25 % » : un train INOUI à 30 minutes pile est compté indemnisable.
          La page SNCF dit aussi « plus de 30 minutes » dans son texte ; nous suivons le tableau.</p>
        <p><strong>Bons ou argent.</strong> En TGV INOUI, l’indemnité est un bon d’achat de 30 minutes à 1 heure de retard, puis de l’argent au-delà d’une heure.
          En OUIGO, c’est un bon d’achat, convertible en virement sur demande (CGV OUIGO, article 3.3.2) : nous le comptons « en bons ».
          Les montants sont séparés en conséquence : part en bons, part en argent.</p>
        <p><strong>Train international.</strong> Un train est international si sa gare d’origine ou de destination a un code UIC qui ne commence pas par 87 (code des gares françaises).
          Le raisonnement se fait par train : un voyageur qui fait Lyon → Montpellier dans un Bruxelles → Montpellier relève en réalité du barème national, ce que l’observatoire ne distingue pas.</p>
        <p><strong>OUIGO et circonstances exceptionnelles.</strong> Le règlement européen permet à un transporteur de ne pas indemniser un retard causé par des circonstances exceptionnelles
          (météo extrême, catastrophe naturelle, personnes sur la voie, vol de câbles, etc. : article 19, paragraphe 10). OUIGO pourrait en théorie l’invoquer, mais ses conditions
          générales ne le font pas : elles n’excluent l’indemnisation que si le voyageur connaissait le retard avant l’achat ou si le retard reste inférieur à 60 minutes (article 3.3.5).
          Les indemnités OUIGO sont donc comptées quel que soit le motif, comme celles des TGV INOUI.</p>
        <p>Sources, lues le 4 novembre 2026 :{' '}
          <Link href="https://www.sncf-connect.com/aide/retard-de-votre-train-et-remboursement">SNCF Connect, retard et remboursement</Link> ;{' '}
          <Link href="https://eur-lex.europa.eu/eli/reg/2021/782/oj">règlement (UE) 2021/782</Link>, articles 19 (indemnisation) et 20 (assistance) ;{' '}
          <Link href="https://cdn-fr.ouigo.com/edito-v3/2026-10/06-10-2026_CGTV-V74-OUIGO.pdf">conditions générales OUIGO n° 74</Link>, en vigueur depuis le 6 octobre 2026.</p>
        <p><strong>Limites.</strong> La garantie G30 ne vaut que pour les trajets sans correspondance : nos montants supposent des trajets directs, de bout en bout du train.
          Aucune indemnité n’est due si le voyageur connaissait le retard avant l’achat, ou s’il a choisi le remboursement de son billet.
          Les montants restent théoriques : prix moyen HT, occupation de 0,75.</p>
        {rules ? (
          <>
            {scales.map(({ brand: b, scope }) => (
              <div className="mt-scroll" key={`${b}-${scope}`}>
                <table>
                  <caption>Barème {b} · {scope} (lu dans la base)</caption>
                  <thead><tr><th scope="col">Retard à l’arrivée</th><th scope="col">Part du billet</th><th scope="col">Forme</th><th scope="col">Source</th></tr></thead>
                  <tbody>
                    {rules.compensation_scale.filter((s) => s.brand === b && (s.scope ?? 'national') === scope).map((s) => (
                      <tr key={s.from_s}>
                        <th scope="row">dès {fmtDuration(s.from_s)} ({nf(s.from_s)} s)</th>
                        <td>{s.pct} %</td>
                        <td>{s.form === 'bon' ? (b === 'OUIGO' ? 'bon (convertible en virement)' : 'bon d’achat') : s.form === 'argent' ? 'argent' : '–'}</td>
                        <td><Link href={s.source_url}>source</Link> (lue le {fmtDate(s.source_as_of)})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <div className="mt-scroll">
              <table>
                <caption>Prix de référence et places (lus dans la base)</caption>
                <thead><tr><th scope="col">Marque</th><th scope="col">Prix moyen HT</th><th scope="col">Places d’une rame</th><th scope="col">Sources</th></tr></thead>
                <tbody>
                  {rules.reference_prices.map((p) => (
                    <tr key={p.brand}>
                      <th scope="row">{p.brand}</th>
                      <td>{nf(p.price_eur_ht)} € ({p.as_of.slice(0, 4)})</td>
                      <td>{nf(p.seats)}</td>
                      <td><Link href={p.price_source.split(' ')[0]}>prix</Link>, <Link href={p.seats_source.split(' ')[0]}>places</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <Unavailable />}
        <h3>Prix de référence : année et évolution</h3>
        <p>Les prix de référence sont ceux de <strong>2023</strong>, hors taxes, tels que les compile la{' '}
          <Link href="https://www.fnaut.fr/uploads/2025/12/chiffres-cles.2electure-docx.pdf">FNAUT d’après les données de l’ART</Link> (communiqué du 15 décembre 2025) :
          ce sont les chiffres les plus récents trouvés pour les deux marques avec une même source et une même année.
          Le jeu ouvert « Tarifs TGV INOUI et OUIGO » de data.gouv.fr n’est pas utilisé : il donne des fourchettes minimum-maximum par liaison, pas un prix moyen payé.</p>
        <p>Depuis 2023, les évolutions connues sont faibles :
          SNCF Voyageurs a annoncé <strong>+1 % en moyenne en 2026</strong>, sous l’inflation prévue de 1,3 %
          (<Link href="https://www.sncf-voyageurs.com/fr/presse/en-2026-levolution-des-prix-des-tgv-inoui-et-ouigo-sera-limitee-en-dessous-de-linflation/">communiqué du 30 décembre 2025</Link>) ;
          pour OUIGO, la presse relaie une donnée de l’ART de <strong>34,70 € en 2024</strong>, soit +1,5 % sur 2023
          (<Link href="https://www.lechotouristique.com/article/sncf-selon-la-fnaut-le-prix-moyen-des-ouigo-aurait-grimpe-de-75-en-7-ans">L’Écho touristique</Link>, source secondaire que nous n’avons pas pu vérifier à la source).
          Aucun chiffre comparable n’existe pour INOUI, ni pour 2025.</p>
        <p>Nous gardons donc les prix de 2023 pour les deux marques, sans les indexer : un coefficient par année et par marque ne reposerait sur aucune source.
          Les prix actuels étant probablement un peu plus élevés, les montants d’indemnités affichés sont <strong>légèrement sous-estimés</strong>. Ils sont proportionnels au prix de référence.</p>
        <h3>Compteur cumulé</h3>
        <p>Le compteur de la carte et du tableau de bord additionne les indemnités théoriques depuis le 20 octobre 2026, jour par jour : chaque jour de service terminé est enregistré la nuit suivante, puis recalculé la nuit d’après pour rattraper les trains terminés tard.
          Les jours pas encore enregistrés, dont le jour en cours, sont ajoutés à la volée (trains déjà terminés seulement) et recalculés toutes les 5 minutes.
          Les blocs « 7J », « 14J » et « 31J » portent sur des jours complets (de J-7 à J-1 pour « 7J ») : leur fenêtre avance à minuit, et le jour en cours apparaît à part sur la ligne « AUJOURD’HUI ».
          Il ne compte que les trains <strong>observés</strong> dans le flux temps réel et n’extrapole jamais aux trains non observés : il sous-estime donc la réalité tant que la couverture (part des trains prévus effectivement observés) est faible. La couverture est toujours affichée à côté du chiffre.</p>
        <p><strong>Hypothèses.</strong> Une seule rame est comptée (les rames couplées ne sont pas connues) : c’est un plancher. L’occupation de référence est de 0,75 : l’Autorité de régulation des transports donne 76 à 77 % pour l’ensemble des TGV en 2023 (<a href="https://www.voyages-d-affaires.com/attrait-transport-ferroviaire-france">rapport annuel, repris par la presse</a>).
          <strong> C’est une moyenne tous TGV, sans détail par marque ni par train</strong> ; le coût est proportionnel à l’occupation, <code>/api/stats</code> fournit aussi le coût à rames pleines.</p>
        <h3>Fourchette</h3>
        <p>Le flux publie les retards par pas de 5 minutes : le retard réel est à moins de 4 min 59 s du retard publié, et le sens de l’arrondi est inconnu. Les montants sont donc donnés avec une fourchette.
          Le montant <strong>central</strong> utilise le retard publié. La borne <strong>haute</strong> ajoute 4 min 59 s à chaque retard (un train publié à 25 minutes atteint alors le seuil de 30 minutes).
          La borne <strong>basse</strong> retire 4 min 59 s et exclut aussi les trains qui sautent un arrêt intermédiaire, dont le retard au terminus reste compté au centre et en haut.
          L’occupation reste à 0,75 dans les trois cas : la fourchette traduit l’incertitude de mesure, pas celle du prix, des places et de l’occupation.</p>
        <h3>Retards aberrants</h3>
        <p>Un retard au terminus d’au moins 12 heures est écarté des mesures (régularité, tranches de retard, indemnités) et compté à part (métrique <code>aberrant</code>, « ABERRANT » dans la décomposition des trains observés) :
          un tel chiffre ne mesure plus un retard, c’est une erreur de donnée ou un train reporté à un autre jour, que le flux ne permet pas de distinguer.</p>
        <p>Seul cas depuis le 20 octobre 2026 : le TGV INOUI <a href="/train/9243">9243</a> Paris Gare de Lyon → Milan du 21 octobre, publié avec 18 h 20 de retard (66 000 secondes) sur tous ses arrêts
          après la panne d’un train de travaux entre Paris et Le Creusot. Compté, il aurait ajouté une indemnité au barème maximal.</p>
      </section>

      <section>
        <h2>Causes de retard</h2>
        <p>Chaque alerte du flux temps réel peut porter un texte de cause. Ce texte est classé par des règles publiques (table <code>cause_rules</code>, voir le{' '}
          <a href={`${REPO}/tree/main/supabase/migrations`}>migrations <code>cause_categories</code> et <code>cause_rules_malveillance</code></a>) : on lit la phrase qui suit « Cause : »
          (sinon le début du message), et la première règle qui correspond, par ordre de priorité, donne la catégorie. Seuls les trains en retard d’au moins 5 minutes au terminus
          sont comptés, hors trains supprimés et retards aberrants.</p>
        <ul>
          {Object.entries(CAUSE_LABELS).map(([code, l]) => <li key={code}>{l.long}</li>)}
        </ul>
        <p><strong>Limites.</strong> La cause est celle que SNCF déclare, elle n’est pas vérifiée. Seule la dernière cause connue d’un train est gardée.
          « Enchaînement » masque la cause d’origine du retard précédent. Les causes n’interviennent pas dans le calcul des indemnités.</p>
      </section>

      <section>
        <h2>Positions sur la carte</h2>
        <p>Les positions sont <strong>estimées</strong>, pas mesurées : chaque arrêt a son horaire prévu corrigé de son retard (publié, ou repris de l’arrêt précédent) ; le train reste à quai jusqu’à son départ corrigé puis avance jusqu’à l’arrivée corrigée de l’arrêt suivant,
          le long du tracé des voies lorsqu’il est connu et en ligne droite sinon. Quand on sélectionne un train, ses tronçons en ligne droite sont dessinés en pointillé : le parcours y est approximatif. Un train dont le dernier passage du collecteur date de plus de 10 minutes est estompé (« donnée périmée »).</p>
        <p><strong>Se localiser.</strong> Le bouton de localisation de la carte demande la position à ton navigateur, avec ton accord. Elle reste dans le navigateur : elle n’est ni envoyée ni enregistrée par le site.</p>
        <p><strong>Calque VMAX.</strong> La vitesse maximale nominale est celle que la voie autorise, publiée par SNCF Réseau : ce n’est ni la vitesse d’un train ni une vitesse mesurée,
          et elle ignore les limitations temporaires. Le calque montre seulement les lignes que longent les tracés des TGV observés (au moins 2 km à moins de 150 m).
          Les données datent du 24 mars 2022 ; une vitesse relevée depuis n’y figure pas. Les lignes étrangères et Perpignan–Figueras n’y sont pas, et la position des sections,
          convertie depuis les points kilométriques, peut s’écarter un peu du tracé des voies.</p>
      </section>

      <section>
        <h2>Diagramme espace-temps (F3 MAREY)</h2>
        <p>La vue F3 trace, pour l’axe Atlantique, la distance depuis Paris selon l’heure, sur une fenêtre de 6 heures centrée sur maintenant. Chaque ligne va de Paris à un terminus
          et ne contient que les gares desservies sur ce parcours ; leur espacement suit la distance le long des voies, en ligne droite lorsque le tracé n’est pas connu ou fait un détour.</p>
        <p>Le pointillé est l’horaire prévu. Le trait plein est <strong>reconstitué</strong> : le collecteur passe toutes les 2 minutes et enregistre chaque changement du retard publié ;
          à chaque instant, le train est placé à la position prévue décalée du retard alors publié pour sa prochaine gare. Une hausse du retard apparaît comme un palier (le temps perdu),
          une baisse comme un rattrapage. Aucune heure de passage n’est constatée dans les données ouvertes : c’est une approximation, qui suit l’annonce du retard et non le train lui-même.
          Après maintenant, le dernier retard connu est prolongé (trait estompé).</p>
      </section>

      <section>
        <h2>Limites connues</h2>
        <ul>
          <li>La collecte a commencé le 20 octobre 2026 : les premières périodes sont incomplètes (beaucoup de trains « jamais observés »).</li>
          <li>Les retards du flux vont par pas de 5 minutes (aucun retard publié entre 1 et 4 minutes). « À l’heure » équivaut à un retard publié de 0 ; la régularité calculée est une approximation de la régularité officielle, à calibrer avant toute comparaison. Les indemnités en dépendent aux seuils de 30 minutes et de 3 heures : d’où la fourchette.</li>
          <li>Les trains absents du plan du jour ne sont pas collectés.</li>
          <li>Les chiffres reposant sur moins de 30 trains ayant circulé sont estompés : ils ne permettent pas de conclure.</li>
          <li>Le barème international (plafonné à 50 %) s’applique à un train dont l’origine ou la destination est hors de France, quel que soit le trajet du voyageur à bord.</li>
          <li>Les indemnités supposent un trajet direct, sans correspondance, de bout en bout du train ; elles ne tiennent pas compte des voyageurs qui connaissaient le retard avant l’achat ou ont choisi le remboursement.</li>
          <li>Le retard est celui du terminus du train : un voyageur qui descend avant a pu arriver avec un autre retard, et son indemnité aussi.</li>
          <li>Quelques gares n’ont pas de tracé (hors réseau du jeu de formes) : les trains y avancent en ligne droite.</li>
        </ul>
      </section>

      <section>
        <h2>Téléchargements</h2>
        <ul>
          <li><Link href="/api/rules">Règles en JSON</Link> (barèmes, seuils de régularité, prix de référence) : <code>/api/rules</code>.</li>
          <li>Journal mensuel des événements en CSV gzip, sous licence ODbL : <Link href={RELEASES}>Releases GitHub</Link>, tag <code>events-AAAA-MM</code>. Le premier export est prévu début novembre 2026.</li>
          <li>Code et données de l’observatoire : <Link href={REPO}>dépôt GitHub</Link>.</li>
        </ul>
      </section>
    </main>
    <FootBar />
    </>
  );
}
