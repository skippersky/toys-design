-- Run in Supabase Dashboard -> SQL Editor after applying the Step 4 migrations.
-- This script is read-only and does not change RLS policies or account balances.

select
  count(*) as profiles_count,
  count(*) filter (where tier = 'free') as free_profiles,
  count(*) filter (where credits >= 0) as non_negative_credit_profiles
from public.profiles;

select
  routine_name,
  routine_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('initialize_profile_for_auth_user', 'check_credits')
order by routine_name;

select
  trigger_name,
  event_manipulation,
  event_object_schema,
  event_object_table
from information_schema.triggers
where trigger_name = 'initialize_profile_after_auth_user_insert';

select
  id,
  tier,
  credits,
  updated_at
from public.profiles
order by updated_at desc
limit 5;
