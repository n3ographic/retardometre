-- Alerte générale SNCF « nous ne sommes pas en mesure d'afficher le retard des trains sur le site Sncf-voyageurs.com.
-- C'est pourquoi, nous vous invitons à consulter régulièrement les informations… » : avis sans cause, rangé en « information ».
-- Priorité 5 : avant « voyageurs_surete », que « Sncf-voyageurs.com » déclencherait depuis que le collecteur garde le titre
-- de l'alerte. Couvre aussi les textes déjà stockés (description seule, « autre » jusqu'ici). Données seules : relancer
-- snapshot_day sur les jours concernés pour daily_stats ; les bilans hebdomadaires déjà figés ne bougent pas.

insert into public.cause_rules (priority, category, pattern, note) values
  (5, 'information', 'en mesure d.afficher le retard|consulter régulièrement les informations qui seront transmises',
   'avis général du site SNCF, sans cause ; avant voyageurs_surete (« Sncf-voyageurs.com »)');
