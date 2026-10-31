-- Fan-signal layer for the vertical feed. Four new tables, nothing existing touched.
-- Supabase project texans-youtube-dashboard (xisvulbabqsyxnlyuwcz). Idempotent.
-- Includes the exclusion trigger: a name on excluded_players can never enter the dictionary.

create table if not exists public.feed_entity_aliases (
  entity_type text        not null,            -- player | coach | staff | opponent | theme
  entity_slug text        not null,            -- c-j-stroud, demeco-ryans, colts, touchdown
  alias       text        not null,            -- lowercased match form, matched on word boundaries
  tier        smallint    not null,            -- 1 full name  2 distinctive surname  3 nickname
  source      text        not null default 'seed',   -- roster | former | manual | seed
  updated_at  timestamptz not null default now(),
  primary key (entity_type, entity_slug, alias)
);

create table if not exists public.feed_video_entities (
  video_id    text        not null,
  entity_type text        not null,
  entity_slug text        not null,
  confidence  real        not null,
  matched_on  text        not null,            -- title | description | schedule
  assigned_at timestamptz not null default now(),
  primary key (video_id, entity_type, entity_slug)
);
create index if not exists feed_video_entities_entity_idx on public.feed_video_entities (entity_type, entity_slug);

create table if not exists public.feed_events (
  id          bigserial primary key,
  session_id  text,
  device_id   text,
  event       text        not null,
  card_id     text,
  video_id    text,
  params      jsonb       not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists feed_events_session_idx on public.feed_events (session_id, at desc);
create index if not exists feed_events_device_idx  on public.feed_events (device_id, at desc);
create index if not exists feed_events_at_idx      on public.feed_events (at);

create table if not exists public.feed_profiles (
  session_id           text primary key,
  identity_key         text,
  entity_weights       jsonb       not null default '{}'::jsonb,
  content_type_weights jsonb       not null default '{}'::jsonb,
  events               integer     not null default 0,
  first_seen           timestamptz not null default now(),
  last_seen            timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists feed_profiles_identity_idx on public.feed_profiles (identity_key) where identity_key is not null;

alter table public.feed_entity_aliases enable row level security;
alter table public.feed_video_entities enable row level security;
alter table public.feed_events          enable row level security;
alter table public.feed_profiles        enable row level security;

drop policy if exists anon_read on public.feed_entity_aliases;
drop policy if exists anon_read on public.feed_video_entities;
create policy anon_read on public.feed_entity_aliases for select to anon, authenticated using (true);
create policy anon_read on public.feed_video_entities for select to anon, authenticated using (true);

-- The exclusion list is excluded_players, which the team already maintains. Slugified the
-- same way the dictionary slugs names, so "Deshaun Watson" and deshaun-watson agree.
create or replace function public.feed_excluded_slugs() returns setof text
language sql stable as $$
  select lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g')) from public.excluded_players;
$$;

create or replace function public.feed_reject_excluded() returns trigger
language plpgsql as $$
begin
  if new.entity_slug in (select public.feed_excluded_slugs()) then
    raise exception 'feed_entity_aliases: % is on excluded_players and cannot be added', new.entity_slug;
  end if;
  return new;
end $$;

drop trigger if exists feed_reject_excluded_trg on public.feed_entity_aliases;
create trigger feed_reject_excluded_trg
  before insert or update on public.feed_entity_aliases
  for each row execute function public.feed_reject_excluded();
