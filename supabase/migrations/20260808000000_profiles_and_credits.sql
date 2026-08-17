do $$
begin
  create type public.subscription_tier as enum ('free', 'pro');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  studio_name text,
  tier public.subscription_tier not null default 'free',
  credits integer not null default 10 check (credits >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add column if not exists studio_name text;

alter table public.profiles
  add column if not exists tier public.subscription_tier not null default 'free';

alter table public.profiles
  add column if not exists credits integer not null default 10;

alter table public.profiles
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create or replace function public.initialize_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, studio_name, tier, credits)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'studio_name', ''),
    'free',
    10
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists initialize_profile_after_auth_user_insert on auth.users;
create trigger initialize_profile_after_auth_user_insert
after insert on auth.users
for each row execute function public.initialize_profile_for_auth_user();

insert into public.profiles (id, studio_name, tier, credits)
select
  users.id,
  nullif(users.raw_user_meta_data ->> 'studio_name', ''),
  'free',
  10
from auth.users as users
on conflict (id) do nothing;

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
    updated_at = timezone('utc', now())
  where id = p_user_id
    and id = auth.uid()
    and credits >= p_credit_cost;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;
