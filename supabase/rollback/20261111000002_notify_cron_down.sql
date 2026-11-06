-- Retour arrière de 20261111000002_notify_cron.sql.
select cron.unschedule('notify');
select cron.unschedule('follows-purge');
