-- Keep pg_cron run history bounded. These rows are operational logs, not
-- business data; keeping 30 days is enough for diagnostics and prevents
-- unbounded growth from every-minute jobs.

create index if not exists job_run_details_end_time_idx
on cron.job_run_details (end_time);

do $$
declare
  v_command text := $cmd$delete from cron.job_run_details where end_time < now() - interval '30 days';$cmd$;
begin
  if exists (select 1 from cron.job where jobname = 'cron_job_run_details_retention_cleanup') then
    update cron.job
       set schedule = '19 5 * * *',
           command = v_command,
           active = true
     where jobname = 'cron_job_run_details_retention_cleanup';
  else
    perform cron.schedule(
      'cron_job_run_details_retention_cleanup',
      '19 5 * * *',
      v_command
    );
  end if;
end;
$$;

delete from cron.job_run_details
where end_time < now() - interval '30 days';
