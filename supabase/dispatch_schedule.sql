-- Run manually in the chosen project after deploying dispatch.
-- First create Vault secrets in Dashboard: procurement_dispatch_url and procurement_dispatch_secret.
-- URL: https://PROJECT.supabase.co/functions/v1/dispatch
-- Secret must match DISPATCH_SECRET from Edge Functions.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.schedule('procurement-dispatch','* * * * *',$$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='procurement_dispatch_url'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='procurement_dispatch_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
