begin;

drop function if exists public.upsert_draft_compensation_rule(jsonb);
drop table if exists public.compensation_rules;

commit;