-- Run once in Supabase Dashboard -> SQL Editor for the configured project.
-- This script is idempotent and intentionally does not modify RLS policies.

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

alter table public.profiles add column if not exists studio_name text;
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

alter table public.projects
  add column if not exists source_project_id uuid references public.projects(id) on delete set null;

create unique index if not exists projects_owner_source_unique_idx
on public.projects (profile_id, source_project_id)
where profile_id is not null and source_project_id is not null;

alter table public.assets
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists assets_single_editor_document_idx
on public.assets (project_id)
where type = 'draft' and metadata @> '{"editor_document": true}'::jsonb;

create or replace function public.save_editor_document(
  p_project_id uuid,
  p_asset_id uuid,
  p_layers jsonb,
  p_metadata jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  updated_project_count integer;
  updated_asset_count integer;
begin
  if jsonb_typeof(p_layers) <> 'array' then
    raise exception 'editor layers must be a JSON array';
  end if;

  if jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'editor asset metadata must be a JSON object';
  end if;

  update public.projects
  set
    layers_json = p_layers,
    updated_at = timezone('utc', now())
  where id = p_project_id
    and coalesce(user_id, profile_id) = auth.uid();

  get diagnostics updated_project_count = row_count;
  if updated_project_count <> 1 then
    raise exception 'project is not owned by the current user';
  end if;

  update public.assets
  set
    metadata = p_metadata,
    version = version + 1,
    updated_at = timezone('utc', now())
  where id = p_asset_id
    and project_id = p_project_id;

  get diagnostics updated_asset_count = row_count;
  if updated_asset_count <> 1 then
    raise exception 'editor asset was not found for the project';
  end if;

  return p_asset_id;
end;
$$;

-- Dashboard evidence. The runtime concurrency proof is produced by:
-- pnpm qa:step4-backend
select
  to_regclass('public.profiles') as profiles_table,
  to_regprocedure('public.check_credits(uuid,integer)') as credit_rpc,
  to_regprocedure('public.save_editor_document(uuid,uuid,jsonb,jsonb)') as save_rpc,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'source_project_id'
  ) as project_clone_contract_ready,
  exists (
    select 1
    from pg_trigger
    where tgname = 'initialize_profile_after_auth_user_insert'
      and not tgisinternal
  ) as profile_trigger_ready;
