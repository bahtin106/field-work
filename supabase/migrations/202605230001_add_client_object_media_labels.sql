alter table public.client_objects
  add column if not exists media_file_1_label text,
  add column if not exists media_file_2_label text,
  add column if not exists media_file_3_label text;
