-- Run after 20260811000000_step4_commercial_baseline.sql.
-- Capture each result grid for the Step 4 evidence bundle.

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'profiles'
order by ordinal_position;

select
  routine_name,
  routine_type,
  data_type as return_type,
  routine_definition ilike '%for update%' as uses_row_lock
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('decrement_credits', 'check_credits')
order by routine_name;

select
  id,
  project_id,
  user_id,
  source_layer_id,
  oss_key,
  metadata
from public.assets
where metadata @> '{"imported_image": true}'::jsonb
order by created_at desc
limit 10;
