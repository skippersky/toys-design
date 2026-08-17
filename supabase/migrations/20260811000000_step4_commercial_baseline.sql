-- Step 4 commercial baseline. This migration intentionally does not alter RLS.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'user_id'
  ) then
    alter table public.profiles rename column id to user_id;
  end if;
end
$$;

alter table public.profiles
  alter column tier drop default;

alter table public.profiles
  alter column tier type text using tier::text;

alter table public.profiles
  alter column tier set default 'free',
  alter column user_id set not null,
  alter column credits set not null;

alter table public.profiles
  drop constraint if exists profiles_tier_check;

alter table public.profiles
  add constraint profiles_tier_check check (tier in ('free', 'pro'));

create or replace function public.initialize_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, studio_name, tier, credits)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'studio_name', ''),
    'free',
    10
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

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
  set
    credits = current_credits - p_amount,
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

alter table public.assets
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists source_layer_id text;

update public.assets as asset
set user_id = coalesce(project.user_id, project.profile_id)
from public.projects as project
where project.id = asset.project_id
  and asset.user_id is null;

do $$
begin
  if not exists (select 1 from public.assets where user_id is null) then
    alter table public.assets alter column user_id set not null;
  end if;
end
$$;

create unique index if not exists assets_project_source_layer_unique_idx
on public.assets (project_id, source_layer_id)
where source_layer_id is not null;

create or replace function public.set_asset_owner_from_project()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  project_owner uuid;
begin
  select coalesce(user_id, profile_id)
  into project_owner
  from public.projects
  where id = new.project_id;

  if project_owner is null then
    raise exception 'asset project has no owner';
  end if;

  if auth.uid() is not null and project_owner <> auth.uid() then
    raise exception 'asset project is not owned by the current user';
  end if;

  if new.user_id is not null and new.user_id <> project_owner then
    raise exception 'asset owner does not match project owner';
  end if;

  new.user_id := project_owner;
  return new;
end;
$$;

drop trigger if exists set_asset_owner_from_project on public.assets;
create trigger set_asset_owner_from_project
before insert or update of project_id, user_id on public.assets
for each row execute function public.set_asset_owner_from_project();

create or replace function public.save_editor_document(
  p_project_id uuid,
  p_asset_id uuid,
  p_layers jsonb,
  p_metadata jsonb,
  p_imported_assets jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  updated_project_count integer;
  updated_asset_count integer;
  imported_asset jsonb;
  imported_layer_id text;
  imported_oss_key text;
  imported_metadata jsonb;
begin
  if jsonb_typeof(p_layers) <> 'array' then
    raise exception 'editor layers must be a JSON array';
  end if;

  if jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'editor asset metadata must be a JSON object';
  end if;

  if jsonb_typeof(p_imported_assets) <> 'array' then
    raise exception 'imported assets must be a JSON array';
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
    user_id = auth.uid(),
    metadata = p_metadata,
    version = version + 1,
    updated_at = timezone('utc', now())
  where id = p_asset_id
    and project_id = p_project_id
    and user_id = auth.uid();

  get diagnostics updated_asset_count = row_count;
  if updated_asset_count <> 1 then
    raise exception 'editor asset was not found for the current user';
  end if;

  for imported_asset in
    select value from jsonb_array_elements(p_imported_assets)
  loop
    imported_layer_id := imported_asset ->> 'layer_id';
    imported_oss_key := imported_asset ->> 'oss_key';
    imported_metadata := imported_asset -> 'metadata';

    if imported_layer_id is null or length(imported_layer_id) = 0 then
      raise exception 'imported asset layer_id is required';
    end if;

    if imported_oss_key is null
      or imported_oss_key not like auth.uid()::text || '/%' then
      raise exception 'imported asset path is outside the current user scope';
    end if;

    if jsonb_typeof(imported_metadata) <> 'object' then
      raise exception 'imported asset metadata must be an object';
    end if;

    insert into public.assets (
      project_id,
      user_id,
      type,
      oss_key,
      metadata,
      source_layer_id,
      version,
      is_final
    )
    values (
      p_project_id,
      auth.uid(),
      'image',
      imported_oss_key,
      imported_metadata,
      imported_layer_id,
      1,
      false
    )
    on conflict (project_id, source_layer_id)
      where source_layer_id is not null
    do update set
      user_id = excluded.user_id,
      oss_key = excluded.oss_key,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now());
  end loop;

  return p_asset_id;
end;
$$;

create or replace function public.save_editor_document(
  p_project_id uuid,
  p_asset_id uuid,
  p_layers jsonb,
  p_metadata jsonb
)
returns uuid
language sql
set search_path = public
as $$
  select public.save_editor_document(
    p_project_id,
    p_asset_id,
    p_layers,
    p_metadata,
    '[]'::jsonb
  );
$$;
