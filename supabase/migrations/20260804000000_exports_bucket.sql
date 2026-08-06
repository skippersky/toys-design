insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do update set public = false;

drop policy if exists "Users upload own exports" on storage.objects;
create policy "Users upload own exports"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'exports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users read own exports" on storage.objects;
create policy "Users read own exports"
on storage.objects for select
to authenticated
using (
  bucket_id = 'exports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users delete own exports" on storage.objects;
create policy "Users delete own exports"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'exports'
  and (storage.foldername(name))[1] = auth.uid()::text
);
