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
