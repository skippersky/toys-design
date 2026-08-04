create or replace function public.check_credits(
  p_user_id uuid,
  p_credit_cost integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if p_credit_cost <= 0 then
    raise exception 'credit cost must be positive';
  end if;

  update public.profiles
  set
    credits = credits - p_credit_cost,
    updated_at = now()
  where id = p_user_id
    and credits >= p_credit_cost;

  get diagnostics updated_count = row_count;

  return updated_count = 1;
end;
$$;
