create table if not exists public.generation_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  editor_asset_id uuid not null references public.assets(id) on delete cascade,
  output_asset_id uuid references public.assets(id) on delete set null,
  comfyui_prompt_id text,
  status text not null default 'reserved',
  progress integer not null default 0,
  credit_cost integer not null default 1,
  request_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.generation_tasks
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists editor_asset_id uuid references public.assets(id) on delete cascade,
  add column if not exists output_asset_id uuid references public.assets(id) on delete set null,
  add column if not exists comfyui_prompt_id text,
  add column if not exists status text not null default 'reserved',
  add column if not exists progress integer not null default 0,
  add column if not exists credit_cost integer not null default 1,
  add column if not exists request_metadata jsonb not null default '{}'::jsonb,
  add column if not exists error_code text,
  add column if not exists error_message text,
  add column if not exists started_at timestamptz not null default timezone('utc', now()),
  add column if not exists completed_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.generation_tasks
set id = gen_random_uuid()
where id is null;

alter table public.generation_tasks
  alter column id set default gen_random_uuid(),
  alter column id set not null;

create unique index if not exists generation_tasks_id_unique_idx
on public.generation_tasks (id);

create index if not exists generation_tasks_user_active_idx
on public.generation_tasks (user_id, status, created_at desc);

create index if not exists generation_tasks_project_idx
on public.generation_tasks (project_id, created_at desc);

create unique index if not exists generation_tasks_comfyui_prompt_unique_idx
on public.generation_tasks (comfyui_prompt_id)
where comfyui_prompt_id is not null;

create or replace function public.reserve_generation_task(
  p_project_id uuid,
  p_editor_asset_id uuid,
  p_credit_cost integer,
  p_request_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_credits integer;
  active_tasks integer;
  task_id uuid;
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;

  if p_credit_cost <= 0 or jsonb_typeof(p_request_metadata) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform 1
  from public.projects
  where id = p_project_id
    and coalesce(user_id, profile_id) = current_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'project_not_found');
  end if;

  perform 1
  from public.assets
  where id = p_editor_asset_id
    and project_id = p_project_id
    and user_id = current_user_id
    and metadata @> '{"editor_document": true}'::jsonb;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'editor_asset_not_found');
  end if;

  select credits
  into current_credits
  from public.profiles
  where user_id = current_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'profile_not_found');
  end if;

  select count(*)::integer
  into active_tasks
  from public.generation_tasks
  where user_id = current_user_id
    and status in ('reserved', 'queued', 'running', 'finalizing');

  if active_tasks >= 2 then
    return jsonb_build_object(
      'ok', false,
      'code', 'too_many_generations',
      'credits_remaining', current_credits
    );
  end if;

  if current_credits < p_credit_cost then
    return jsonb_build_object(
      'ok', false,
      'code', 'insufficient_credits',
      'credits_remaining', current_credits
    );
  end if;

  update public.profiles
  set credits = credits - p_credit_cost,
      updated_at = timezone('utc', now())
  where user_id = current_user_id;

  insert into public.generation_tasks (
    user_id,
    project_id,
    editor_asset_id,
    status,
    progress,
    credit_cost,
    request_metadata
  )
  values (
    current_user_id,
    p_project_id,
    p_editor_asset_id,
    'reserved',
    0,
    p_credit_cost,
    p_request_metadata
  )
  returning id into task_id;

  return jsonb_build_object(
    'ok', true,
    'task_id', task_id,
    'credits_remaining', current_credits - p_credit_cost
  );
end;
$$;

create or replace function public.mark_generation_task_queued(
  p_task_id uuid,
  p_prompt_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null or p_prompt_id is null or length(p_prompt_id) = 0 then
    return false;
  end if;

  update public.generation_tasks
  set comfyui_prompt_id = p_prompt_id,
      status = 'queued',
      updated_at = timezone('utc', now())
  where id = p_task_id
    and user_id = auth.uid()
    and status = 'reserved';

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.update_generation_task_progress(
  p_task_id uuid,
  p_status text,
  p_progress integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null
    or p_status not in ('queued', 'running', 'finalizing')
    or p_progress < 0
    or p_progress > 100 then
    return false;
  end if;

  update public.generation_tasks
  set status = p_status,
      progress = greatest(progress, p_progress),
      updated_at = timezone('utc', now())
  where id = p_task_id
    and user_id = auth.uid()
    and status in ('reserved', 'queued', 'running', 'finalizing');

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.fail_generation_task(
  p_task_id uuid,
  p_error_code text,
  p_error_message text,
  p_refund boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  task_record public.generation_tasks%rowtype;
  remaining_credits integer;
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;

  select *
  into task_record
  from public.generation_tasks
  where id = p_task_id and user_id = current_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'task_not_found');
  end if;

  if task_record.status in ('completed', 'failed', 'cancelled') then
    select credits into remaining_credits
    from public.profiles where user_id = current_user_id;
    return jsonb_build_object(
      'ok', true,
      'already_terminal', true,
      'credits_remaining', remaining_credits
    );
  end if;

  if p_refund and task_record.refunded_at is null then
    update public.profiles
    set credits = credits + task_record.credit_cost,
        updated_at = timezone('utc', now())
    where user_id = current_user_id
    returning credits into remaining_credits;
  else
    select credits into remaining_credits
    from public.profiles where user_id = current_user_id;
  end if;

  update public.generation_tasks
  set status = 'failed',
      error_code = left(coalesce(p_error_code, 'generation_failed'), 120),
      error_message = left(coalesce(p_error_message, 'Generation failed.'), 2000),
      refunded_at = case
        when p_refund and refunded_at is null then timezone('utc', now())
        else refunded_at
      end,
      completed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = p_task_id;

  return jsonb_build_object(
    'ok', true,
    'credits_remaining', remaining_credits,
    'refunded', p_refund and task_record.refunded_at is null
  );
end;
$$;

create or replace function public.complete_generation_task(
  p_task_id uuid,
  p_storage_path text,
  p_asset_metadata jsonb,
  p_editor_layer jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  task_record public.generation_tasks%rowtype;
  editor_metadata jsonb;
  next_layers jsonb;
  next_storage_keys jsonb;
  layer_id text;
  new_output_asset_id uuid;
  remaining_credits integer;
begin
  if current_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'unauthorized');
  end if;

  if jsonb_typeof(p_asset_metadata) <> 'object'
    or jsonb_typeof(p_editor_layer) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_metadata');
  end if;

  layer_id := p_editor_layer ->> 'id';
  if layer_id is null
    or length(layer_id) = 0
    or p_editor_layer ->> 'type' <> 'image'
    or p_storage_path is null
    or p_storage_path not like current_user_id::text || '/%' then
    return jsonb_build_object('ok', false, 'code', 'invalid_output');
  end if;

  select *
  into task_record
  from public.generation_tasks
  where id = p_task_id and user_id = current_user_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'task_not_found');
  end if;

  if task_record.status not in ('queued', 'running', 'finalizing') then
    return jsonb_build_object('ok', false, 'code', 'task_not_active');
  end if;

  select metadata
  into editor_metadata
  from public.assets
  where id = task_record.editor_asset_id
    and project_id = task_record.project_id
    and user_id = current_user_id
    and metadata @> '{"editor_document": true}'::jsonb
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'editor_asset_not_found');
  end if;

  next_layers := coalesce(editor_metadata -> 'layers', '[]'::jsonb)
    || jsonb_build_array(p_editor_layer);
  next_storage_keys := coalesce(
    editor_metadata -> 'layer_storage_keys',
    '{}'::jsonb
  ) || jsonb_build_object(layer_id, p_storage_path);

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
    task_record.project_id,
    current_user_id,
    'image',
    p_storage_path,
    p_asset_metadata || jsonb_build_object(
      'ai_generated', true,
      'generation_task_id', task_record.id,
      'editor_asset_id', task_record.editor_asset_id,
      'editor_layer', p_editor_layer
    ),
    layer_id,
    1,
    false
  )
  returning id into new_output_asset_id;

  update public.assets
  set metadata = editor_metadata || jsonb_build_object(
        'layers', next_layers,
        'layer_storage_keys', next_storage_keys
      ),
      version = version + 1,
      updated_at = timezone('utc', now())
  where id = task_record.editor_asset_id;

  update public.projects
  set layers_json = next_layers,
      updated_at = timezone('utc', now())
  where id = task_record.project_id
    and coalesce(user_id, profile_id) = current_user_id;

  update public.generation_tasks
  set output_asset_id = new_output_asset_id,
      status = 'completed',
      progress = 100,
      completed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = task_record.id;

  select credits into remaining_credits
  from public.profiles where user_id = current_user_id;

  return jsonb_build_object(
    'ok', true,
    'asset_id', new_output_asset_id,
    'credits_remaining', remaining_credits
  );
end;
$$;
