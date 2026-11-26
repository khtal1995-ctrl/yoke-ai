-- the project tick (episodes + rolls) only fired while an episode was producing/stitching, so a roll stuck in
-- 'joining' was never collected. Now it also fires for planning episodes and joining rolls.
select cron.alter_job((select jobid from cron.job where jobname='episode-tick'), command := $c$
  select net.http_post(url := 'https://isceklnjifckepgumale.supabase.co/functions/v1/project',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-token', public.get_app_secret('cron_token')),
    body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 120000)
  where exists (select 1 from public.episodes where status in ('planning','producing','stitching'))
     or exists (select 1 from public.rolls where status = 'joining');
$c$);
