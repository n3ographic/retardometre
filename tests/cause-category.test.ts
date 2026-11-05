import { afterEach, beforeAll, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { makeDb, resetData, seedTrip, type SeedTrip } from './sql/harness.ts'

const NOW = '2026-11-02T12:00:00Z'
let db: PGlite
beforeAll(async () => { db = await makeDb(); await resetData(db) })
afterEach(async () => { await resetData(db) })

const category = async (cause: string | null) =>
  (await db.query<{ c: string }>('select public.cause_category($1) as c', [cause])).rows[0].c

test.each([
  [null, 'sans_cause'],
  ['Cause : le conducteur a dû ralentir pour garantir la distance de sécurité entre les trains à MÂCON.', 'regulation'],
  ["Cause : le matériel utilisé pour assurer votre train a été retardé sur son précédent trajet à LILLE FLANDRES en raison du heurt d'un animal", 'enchainement'],
  ["Cause : votre train a fait l'objet d'une intervention de maintenance à NÎMES CENTRE. Pour mieux comprendre la gestion de cet incident.", 'materiel'],
  ["Les conditions climatiques actuelles nécessitent l'application de mesures de sécurité sur votre itinéraire. Des ralentissements sont imposés.", 'meteo'],
  ["Cause : défaut d'alimentation électrique entre LABOUHEYRE et MORCENX. Les équipes du gestionnaire du réseau ferré sont en cours d'intervention. Pour les voyageurs concernés par la suppression, vérifiez vos mails.", 'infrastructure'],
  ['Votre retard est dû à deux incidents distincts : Les conditions climatiques actuelles nécessitent des mesures.', 'plusieurs'],
  ['Cause : un obstacle a été signalé sur les voies à GRAFFENSTADEN.', 'obstacle'],
  ['Cause : opération de sûreté à PERPIGNAN.', 'voyageurs_surete'],
  ['Cause : feuilles sur les voies entre VALENCIENNES et DOUAI.', 'meteo'],
  ["Cause : votre train fait l'objet de vérifications techniques à MODANE.", 'materiel'],
  ['Des travaux de renouvellement des appareils de voie sont en cours sur la ligne à grande vitesse à Roeux', 'infrastructure'],
  ["Cause : emprunt d'un autre itinéraire avec modification de la desserte du train à HYÈRES.", 'information'],
  ["Retard affectant votre train. En raison d'un incident d’exploitation survenu au cours du trajet, votre train circule actuellement avec un retard.", 'exploitation'],
  ['Cause : orage violent à RENNES.', 'meteo'],
  ['Gare de Tourcoing : texte sans rapport connu', 'autre'],
  ["Actuellement, nous ne sommes pas en mesure d'afficher le retard des trains sur le site Sncf-voyageurs.com. C'est pourquoi, nous vous invitons à consulter régulièrement les informations qui seront transmises ici.", 'information'],
  ["C'est pourquoi, nous vous invitons à consulter régulièrement les informations qui seront transmises ici, en temps réel.", 'information'],
  // Textes réels restés en « autre » jusqu'au 27/10/2026.
  ['Cause : un vol de câbles entraîne des perturbations sur la circulation des trains à REIMS.', 'malveillance'],
  ['Cause : acte de vandalisme sur les installations à LYON.', 'malveillance'],
  ['Cause : des manifestants ont été aperçus sur les voies à PERPIGNAN.', 'voyageurs_surete'],
  ['Cause : Attente de personnel indispensable à votre train à LYON PART DIEU.', 'enchainement'],
  ["La mission précédente de votre train a été retardé par une interruption des circulations du fait de la présence de manifestants dans les voies.", 'enchainement'],
  ["En répercussion des conditions météorologiques liées à la tempête AUSTEN, 2 TGV ont été supprimés. Cause : suppression d'un train précédent devant assurer cet arrêt à MEUSE TGV.", 'enchainement'],
  ["Cause : changement de composition de votre train à la suite d'un problème technique à GRENOBLE.", 'materiel'],
  ['Cause : un défaut a été détecté sur votre train nécessitant une vérification à CHAMPAGNE ARDENNE TGV.', 'materiel'],
  ['Votre train est retardé. Cause : votre conducteur a procédé à une vérification technique et a pu reprendre ensuite sa circulation à TOUTRY.', 'materiel'],
  ["Les équipes du gestionnaire du réseau ferré sont en cours d'intervention. Cause : panne du système informatique à MODANE.", 'infrastructure'],
  ['Votre TGV INOUI a quitté la gare avec du retard. Ce retard était dû à des conditions de départ non réunies avant la mise en circulation du train.', 'exploitation'],
  ["Cause : signal d'alarme tiré abusivement entre TOULON et MARSEILLE SAINT CHARLES.", 'malveillance'],
  ["Cause : un voyageur a actionné un signal d'alarme à bord d'un train à AGEN.", 'voyageurs_surete'],
  // Textes réels restés en « autre » jusqu'au 05/11/2026.
  ['Cause : mouvement social national perturbant la circulation des trains. La circulation de votre TGV est modifiée.', 'greve'],
  ['Cause : un mouvement social interprofessionnel perturbe la circulation des TGV INOUI.', 'greve'],
  ['Cause : un mouvement social perturbe la circulation des TGV INOUI / INTERCITÉS / OUIGO à BORDEAUX.', 'greve'],
  ['Cause : grève de contrôleurs à NANTES.', 'greve'],
  ['Cause : le matériel utilisé pour assurer votre train a été retardé sur son précédent trajet en raison d’un mouvement social.', 'enchainement'],
  // « dégradation » de la météo reste de la météo (règle météo prioritaire).
  ['Cause : dégradation des conditions météorologiques à BREST.', 'meteo'],
])('cause_category(%s) = %s', async (cause, expected) => {
  expect(await category(cause)).toBe(expected)
})

const ARR = '2026-11-01T20:00:00Z'
const ORAGE = 'Cause : orage violent à RENNES.'
const trip = (tripId: string, circulation: SeedTrip['circulation']): SeedTrip => ({
  serviceDate: '2026-11-01', tripId, brand: 'INOUI', axis: 'SUD_EST', trainNumber: tripId,
  dep: '2026-11-01T17:00:00Z', arr: ARR, circulation,
})

test('stats_period : mesures par cause, trains ≥ 300 s seulement', async () => {
  for (const t of [
    trip('A', { terminusDelayS: 600, cause: ORAGE }),
    trip('B', { terminusDelayS: 1860, cause: ORAGE }),
    trip('C', { terminusDelayS: 7200 }),
    trip('D', { terminusDelayS: 299, cause: ORAGE }),
    trip('E', { cancelled: true, terminusDelayS: null, cause: ORAGE }),
    trip('F', { terminusDelayS: 43200, cause: ORAGE }),
  ]) await seedTrip(db, t)
  const r = await db.query<{ metric: string; n: string }>(
    "select metric, sum(n)::text as n from public.stats_period($1, $1, $2) where metric like 'cause%' group by metric", ['2026-11-01', NOW])
  expect(Object.fromEntries(r.rows.map((x) => [x.metric, Number(x.n)]))).toEqual({
    'cause:meteo': 2, 'cause_delay_s:meteo': 2460, 'cause_comp:meteo': 25,
    'cause:sans_cause': 1, 'cause_delay_s:sans_cause': 7200, 'cause_comp:sans_cause': 50,
  })
})
