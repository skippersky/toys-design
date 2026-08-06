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
