create or replace function public.decrement_credits(
  p_user_id uuid,
  p_amount integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_credits integer;
begin
  if p_amount <= 0 then
    raise exception 'credit amount must be positive';
  end if;

  if p_user_id <> auth.uid() then
    return false;
  end if;

  select credits
  into current_credits
  from public.profiles
  where user_id = p_user_id
  for update;

  if current_credits is null or current_credits < p_amount then
    return false;
  end if;

  update public.profiles
  set credits = current_credits - p_amount,
      updated_at = timezone('utc', now())
  where user_id = p_user_id;

  return true;
end;
$$;

create or replace function public.check_credits(
  p_user_id uuid,
  p_credit_cost integer default 1
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.decrement_credits(p_user_id, p_credit_cost);
$$;
