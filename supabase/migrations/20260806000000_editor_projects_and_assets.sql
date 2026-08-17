create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references auth.users(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  style text not null default 'custom',
  ratio text not null default '16:9',
  ip_ref_url text,
  status text not null default 'draft',
  thumbnail_url text,
  layers_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.projects add column if not exists profile_id uuid references auth.users(id) on delete cascade;
alter table public.projects add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.projects add column if not exists style text default 'custom';
alter table public.projects add column if not exists ratio text default '16:9';
alter table public.projects add column if not exists ip_ref_url text;
alter table public.projects add column if not exists status text default 'draft';
alter table public.projects add column if not exists thumbnail_url text;
alter table public.projects add column if not exists layers_json jsonb default '[]'::jsonb;
alter table public.projects add column if not exists updated_at timestamptz default timezone('utc', now());

create or replace function public.set_project_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.user_id := coalesce(new.user_id, new.profile_id);
  new.profile_id := coalesce(new.profile_id, new.user_id);
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_project_defaults on public.projects;
create trigger set_project_defaults
before insert or update on public.projects
for each row execute function public.set_project_defaults();

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null default 'draft',
  oss_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  is_final boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.assets add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.assets add column if not exists type text default 'draft';
alter table public.assets add column if not exists oss_key text;
alter table public.assets add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.assets add column if not exists version integer default 1;
alter table public.assets add column if not exists is_final boolean default false;

create index if not exists projects_owner_updated_idx
on public.projects (user_id, updated_at desc);

create index if not exists assets_project_id_idx
on public.assets (project_id);

alter table public.projects enable row level security;
alter table public.assets enable row level security;

drop policy if exists "Project owners can read projects" on public.projects;
create policy "Project owners can read projects"
on public.projects for select
to authenticated
using (coalesce(user_id, profile_id) = auth.uid());

drop policy if exists "Project owners can create projects" on public.projects;
create policy "Project owners can create projects"
on public.projects for insert
to authenticated
with check (coalesce(user_id, profile_id) = auth.uid());

drop policy if exists "Project owners can update projects" on public.projects;
create policy "Project owners can update projects"
on public.projects for update
to authenticated
using (coalesce(user_id, profile_id) = auth.uid())
with check (coalesce(user_id, profile_id) = auth.uid());

drop policy if exists "Project owners can delete projects" on public.projects;
create policy "Project owners can delete projects"
on public.projects for delete
to authenticated
using (coalesce(user_id, profile_id) = auth.uid());

drop policy if exists "Project owners can read assets" on public.assets;
create policy "Project owners can read assets"
on public.assets for select
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = assets.project_id
      and coalesce(projects.user_id, projects.profile_id) = auth.uid()
  )
);

drop policy if exists "Project owners can create assets" on public.assets;
create policy "Project owners can create assets"
on public.assets for insert
to authenticated
with check (
  exists (
    select 1
    from public.projects
    where projects.id = assets.project_id
      and coalesce(projects.user_id, projects.profile_id) = auth.uid()
  )
);

drop policy if exists "Project owners can update assets" on public.assets;
create policy "Project owners can update assets"
on public.assets for update
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = assets.project_id
      and coalesce(projects.user_id, projects.profile_id) = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.projects
    where projects.id = assets.project_id
      and coalesce(projects.user_id, projects.profile_id) = auth.uid()
  )
);

drop policy if exists "Project owners can delete assets" on public.assets;
create policy "Project owners can delete assets"
on public.assets for delete
to authenticated
using (
  exists (
    select 1
    from public.projects
    where projects.id = assets.project_id
      and coalesce(projects.user_id, projects.profile_id) = auth.uid()
  )
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'assets',
  'assets',
  false,
  26214400,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;

drop policy if exists "Users upload own editor assets" on storage.objects;
create policy "Users upload own editor assets"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users read own editor assets" on storage.objects;
create policy "Users read own editor assets"
on storage.objects for select
to authenticated
using (
  bucket_id = 'assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users update own editor assets" on storage.objects;
create policy "Users update own editor assets"
on storage.objects for update
to authenticated
using (
  bucket_id = 'assets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete own editor assets" on storage.objects;
create policy "Users delete own editor assets"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

insert into public.projects (
  id,
  name,
  style,
  ratio,
  status,
  thumbnail_url,
  layers_json,
  created_at,
  updated_at
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'Cyberpunk Alley',
    'cyberpunk',
    '16:9',
    'draft',
    'https://placehold.co/1200x675/111827/22d3ee.png?text=Cyberpunk+Alley',
    '[{"id":"11111111-1111-4111-8111-111111111101","type":"image","name":"Cyberpunk Alley","visible":true,"locked":false,"opacity":1,"blendMode":"normal","x":0,"y":0,"width":3840,"height":2160,"scaleX":1,"scaleY":1,"rotation":0,"src":"https://placehold.co/1200x675/111827/22d3ee.png?text=Cyberpunk+Alley","originalWidth":1200,"originalHeight":675}]'::jsonb,
    '2026-08-06T00:00:00Z',
    '2026-08-06T08:30:00Z'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'Neon Sign',
    'neon',
    '16:9',
    'draft',
    'https://placehold.co/1200x675/18181b/f472b6.png?text=Neon+Sign',
    '[{"id":"22222222-2222-4222-8222-222222222202","type":"image","name":"Neon Sign","visible":true,"locked":false,"opacity":1,"blendMode":"normal","x":0,"y":0,"width":3840,"height":2160,"scaleX":1,"scaleY":1,"rotation":0,"src":"https://placehold.co/1200x675/18181b/f472b6.png?text=Neon+Sign","originalWidth":1200,"originalHeight":675}]'::jsonb,
    '2026-08-06T00:00:00Z',
    '2026-08-05T15:10:00Z'
  )
on conflict (id) do nothing;
