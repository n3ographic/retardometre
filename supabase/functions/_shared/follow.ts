// Décision de la fonction notify pour un suivi de train (spec : docs/superpowers/specs/2026-11-06-train-push-design.md).
// Pure : état déjà notifié + état courant (follow_states) → message à envoyer et nouvel état, ou null.

export type FollowState = {
  train_number: string; brand: string; stop_name: string | null; last_step: number
  delay_s: number | null; cancelled: boolean; stop_cancelled: boolean; arrived: boolean
  comp_pct: number; comp_form: string | null
}
// next : palier à enregistrer (minutes), ou 'done' pour effacer le suivi.
export type Decision = { title: string; body: string; next: number | 'done' }

export const STEPS = [5, 15, 30, 60, 120]

const min = (s: number) => Math.round(s / 60)
const comp = (s: FollowState) =>
  s.comp_pct > 0 ? ` Indemnité possible : ${s.comp_pct} % ${s.comp_form === 'argent' ? 'en argent' : 'en bon d’achat'}.` : ''

export function decide(s: FollowState): Decision | null {
  const train = `${s.brand === 'OUIGO' ? 'OUIGO' : 'TGV INOUI'} ${s.train_number}`
  const gare = s.stop_name ?? 'la gare suivie'
  if (s.cancelled) return { title: `${train} supprimé`, body: 'Le train est supprimé. Fin du suivi.', next: 'done' }
  if (s.stop_cancelled) return { title: `${train} : arrêt supprimé`, body: `Le train ne dessert plus ${gare}. Fin du suivi.`, next: 'done' }
  if (s.arrived) {
    // Train observé sans retard publié à cette gare : arrêt vu à l'heure (le flux ne signale pas un premier retard nul).
    const d = s.delay_s ?? 0
    return { title: `${train} arrivé à ${gare}`, body: d < 300 ? 'À l’heure.' : `Avec ${min(d)} min de retard.${comp(s)}`, next: 'done' }
  }
  if (s.delay_s === null) return null
  const step = STEPS.filter((x) => s.delay_s! >= x * 60).at(-1) ?? 0
  if (step > s.last_step) {
    return { title: `${train} · +${min(s.delay_s)}′`, body: `Retard prévu à ${gare} : ${min(s.delay_s)} min.${step >= 30 ? comp(s) : ''}`, next: step }
  }
  if (step === 0 && s.last_step > 0) {
    return { title: `${train} · retard rattrapé`, body: `Moins de 5 min de retard prévues à ${gare}.`, next: 0 }
  }
  return null
}
