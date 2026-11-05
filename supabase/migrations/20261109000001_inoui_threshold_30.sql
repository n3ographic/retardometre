-- Palier INOUI de 25 % : 1860 s (31 min) → 1800 s (30 min), en national comme en international.
-- Source : SNCF Connect, « Retard de votre train et remboursement », tableau du barème : « Entre 30 min et 2h : 25 % ».
-- Le texte de la même page dit « plus de 30 minutes » ; le tableau fait foi ici (voir la méthodologie).
-- Paliers de 1 h (3660 s, passage du bon à l'argent) et de 3 h (10860 s) inchangés.
-- Effet : 58 trains INOUI à 1800 s pile du 29/10 au 04/11, 144 du 20/10 au 04/11 (aucun entre 1801 et 1859 s).
-- Après application : relancer snapshot_day du 20/10 à la veille ; weekly_reports (semaines figées) non modifiés.

-- Retour arrière : supabase/rollback/20261109000001_inoui_threshold_30_down.sql
begin;

update public.compensation_scale
  set from_s = 1800, source_as_of = '2026-11-05',
      note = 'entre 30 min et 2 h (tableau SNCF Connect), bon d''achat jusqu''à 1 h'
  where brand = 'INOUI' and from_s = 1860;

commit;
