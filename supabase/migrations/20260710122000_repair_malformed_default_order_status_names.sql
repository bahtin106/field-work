begin;

-- Repair only values produced by the earlier transport-encoding failure.
-- A normal user-defined name cannot match this pattern.
alter table public.company_order_statuses
  disable trigger trg_company_order_statuses_guard_write;

update public.company_order_statuses
   set name = case status_key
     when 'feed' then U&'\0412 \043B\0435\043D\0442\0435'
     when 'new' then U&'\041D\043E\0432\044B\0439'
     when 'in_progress' then U&'\0412 \0440\0430\0431\043E\0442\0435'
     when 'done' then U&'\0417\0430\0432\0435\0440\0448\0451\043D\043D\0430\044F'
     when 'waiting' then U&'\0412 \043E\0436\0438\0434\0430\043D\0438\0438'
     else name
   end
 where status_key in ('feed', 'new', 'in_progress', 'done', 'waiting')
   and name ~ '^[? ]+$';

alter table public.company_order_statuses
  enable trigger trg_company_order_statuses_guard_write;

commit;
