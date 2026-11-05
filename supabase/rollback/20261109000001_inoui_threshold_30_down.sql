-- Retour arrière de 20261109000001_inoui_threshold_30.sql : palier INOUI de 25 % ramené à 1860 s.
begin;

update public.compensation_scale
  set from_s = 1860, source_as_of = '2026-11-04',
      note = case scope when 'national' then 'plus de 30 min (31 min et plus), bon d''achat jusqu''à 1 h'
                        else 'plus de 30 min, bon d''achat jusqu''à 1 h' end
  where brand = 'INOUI' and from_s = 1800;

commit;
