do $$
begin
  perform cron.unschedule('cleanup-expired-yookassa-pending-payments');
exception
  when others then
    null;
end $$;

select cron.schedule(
  'cleanup-expired-yookassa-pending-payments',
  '* * * * *',
  $$
    delete from public.billing_yookassa_payments
    where status = 'pending'
      and created_at < now() - interval '7 minutes';
  $$
);

delete from public.billing_yookassa_payments
where status = 'pending'
  and created_at < now() - interval '7 minutes';
