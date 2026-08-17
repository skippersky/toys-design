insert into public.projects (
  id,
  profile_id,
  user_id,
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
    null,
    null,
    'Cyberpunk Alley',
    'cyberpunk',
    '16:9',
    'draft',
    'https://placehold.co/600x400/png?text=Cyberpunk+Alley',
    '[{"id":"11111111-1111-4111-8111-111111111101","type":"image","name":"Cyberpunk Alley","visible":true,"locked":false,"opacity":1,"blendMode":"normal","x":300,"y":0,"width":3240,"height":2160,"scaleX":1,"scaleY":1,"rotation":0,"src":"https://placehold.co/600x400/png?text=Cyberpunk+Alley","originalWidth":600,"originalHeight":400}]'::jsonb,
    '2026-08-06T00:00:00Z',
    timezone('utc', now())
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    null,
    null,
    'Neon Sign',
    'neon',
    '16:9',
    'draft',
    'https://placehold.co/600x400/png?text=Neon+Sign',
    '[{"id":"22222222-2222-4222-8222-222222222202","type":"image","name":"Neon Sign","visible":true,"locked":false,"opacity":1,"blendMode":"normal","x":300,"y":0,"width":3240,"height":2160,"scaleX":1,"scaleY":1,"rotation":0,"src":"https://placehold.co/600x400/png?text=Neon+Sign","originalWidth":600,"originalHeight":400}]'::jsonb,
    '2026-08-06T00:00:00Z',
    timezone('utc', now())
  )
on conflict (id) do update
set
  profile_id = null,
  user_id = null,
  name = excluded.name,
  style = excluded.style,
  ratio = excluded.ratio,
  status = excluded.status,
  thumbnail_url = excluded.thumbnail_url,
  layers_json = excluded.layers_json,
  updated_at = excluded.updated_at;
