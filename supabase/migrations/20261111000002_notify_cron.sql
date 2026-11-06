-- Fonction notify toutes les 2 min, une minute après collect (données fraîches) ; même secret que collect.
-- Purge horaire des suivis de plus de 48 h (train jamais vu arriver, abonnement abandonné).
-- À appliquer après le déploiement de la fonction notify et la pose des secrets VAPID.
-- Retour arrière : supabase/rollback/20261111000002_notify_cron_down.sql
select cron.schedule('notify', '1-59/2 * * * *', $$
  select net.http_post(
    url := 'https://jsbwehfkvcasuyynfwga.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-collector-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collector_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);

select cron.schedule('follows-purge', '7 * * * *', $$
  delete from public.train_follows where created_at < now() - interval '48 hours'
$$);
