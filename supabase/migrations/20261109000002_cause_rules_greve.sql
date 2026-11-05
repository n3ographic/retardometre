-- Catégorie « grève » : textes « mouvement social » restés en « autre » (49 trains du 03/11 au 05/11/2026).
-- Priorité 47 : après malveillance, avant voyageurs_surete (qui lit « manifestations »). Comme pour les manifestants,
-- un retard venu d'un trajet précédent reste en enchaînement.
-- Données seules : relancer snapshot_day du 03/11 à la veille pour daily_stats.
-- Retour arrière : supabase/rollback/20261109000002_cause_rules_greve_down.sql

insert into public.cause_rules (priority, category, pattern, note) values
  (47, 'greve', '\m(grèves?|grévistes?)\M|mouvements? soci(al|aux)|préavis',
   'mouvement social national ou interprofessionnel, grève, préavis');
