import { expect, test } from 'vitest'
import { decide, type FollowState } from '../supabase/functions/_shared/follow.ts'

const st = (o: Partial<FollowState>): FollowState => ({
  train_number: '8308', brand: 'INOUI', stop_name: 'Bordeaux', last_step: 0, delay_s: 0,
  cancelled: false, stop_cancelled: false, arrived: false, comp_pct: 0, comp_form: null, ...o,
})

test('montée : un seul message au plus haut palier atteint, indemnité à partir de 30′', () => {
  expect(decide(st({ delay_s: 600 }))).toEqual({ title: 'TGV INOUI 8308 · +10′', body: 'Retard prévu à Bordeaux : 10 min.', next: 5 })
  const r = decide(st({ last_step: 5, delay_s: 2100, comp_pct: 25, comp_form: 'bon' }))
  expect(r).toEqual({ title: 'TGV INOUI 8308 · +35′', body: 'Retard prévu à Bordeaux : 35 min. Indemnité possible : 25 % en bon d’achat.', next: 30 })
})

test('rien : sous 5′, même palier, baisse entre deux paliers, retard inconnu', () => {
  expect(decide(st({ delay_s: 0 }))).toBeNull()
  expect(decide(st({ last_step: 15, delay_s: 1200 }))).toBeNull()
  expect(decide(st({ last_step: 30, delay_s: 1200 }))).toBeNull()
  expect(decide(st({ last_step: 5, delay_s: null }))).toBeNull()
})

test('retard rattrapé : sous 5′ après au moins un palier, palier remis à 0', () => {
  expect(decide(st({ last_step: 15, delay_s: 0 }))).toEqual({ title: 'TGV INOUI 8308 · retard rattrapé', body: 'Moins de 5 min de retard prévues à Bordeaux.', next: 0 })
})

test('fin : suppression du train ou de la gare, arrivée avec retard et indemnité', () => {
  expect(decide(st({ cancelled: true, delay_s: 900 }))).toEqual({ title: 'TGV INOUI 8308 supprimé', body: 'Le train est supprimé. Fin du suivi.', next: 'done' })
  expect(decide(st({ stop_cancelled: true, brand: 'OUIGO' }))).toEqual({ title: 'OUIGO 8308 : arrêt supprimé', body: 'Le train ne dessert plus Bordeaux. Fin du suivi.', next: 'done' })
  expect(decide(st({ arrived: true, delay_s: 2400, comp_pct: 25, comp_form: 'bon' }))).toEqual({
    title: 'TGV INOUI 8308 arrivé à Bordeaux', body: 'Avec 40 min de retard. Indemnité possible : 25 % en bon d’achat.', next: 'done' })
  expect(decide(st({ arrived: true, delay_s: 3900, comp_pct: 25, comp_form: 'argent' }))?.body).toBe('Avec 65 min de retard. Indemnité possible : 25 % en argent.')
  expect(decide(st({ arrived: true, delay_s: 0 }))?.body).toBe('À l’heure.')
  // L'arrivée l'emporte sur un palier pas encore envoyé.
  expect(decide(st({ arrived: true, delay_s: 600 }))?.next).toBe('done')
})
