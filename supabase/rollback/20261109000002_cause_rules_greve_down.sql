-- Retour arrière de 20261109000002_cause_rules_greve.sql, puis relancer snapshot_day du 03/11 à la veille.
delete from public.cause_rules where category = 'greve';
