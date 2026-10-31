-- Studio-published cards, mirrored from the editorial studio so the public Worker can serve
-- them without a file store. One row per card; the whole ContentItem rides in `item`.
-- Only published rows are readable with the publishable key. Idempotent.
create table if not exists public.feed_items (
  id           text primary key,
  status       text        not null,
  collection   text        not null,
  sort_index   integer     not null default 0,
  published_at timestamptz,
  item         jsonb       not null,
  updated_at   timestamptz not null default now()
);
create index if not exists feed_items_live_idx on public.feed_items (status, sort_index, published_at desc);

alter table public.feed_items enable row level security;
drop policy if exists anon_read_published on public.feed_items;
create policy anon_read_published on public.feed_items
  for select to anon, authenticated using (status = 'published');
