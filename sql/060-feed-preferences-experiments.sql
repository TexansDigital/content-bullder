-- The preference layer and the experiment program.
--
-- feed_preferences   what a fan told us on purpose: up to three players, the lanes they want
--                    more of, watch-or-read, a preset they follow (TORO's picks), and
--                    time-boxed boosts ("draft news until 24 Apr"). Keyed by the same
--                    pseudonymous id as feed_profiles. Nothing personal. Written only by the
--                    Worker with the service key; never readable with the publishable key.
-- feed_presets       named weight sets a fan can follow. Seeded with TORO. A player's own
--                    picks need that player's sign-off before a row is added here.
-- feed_boost_offers  editorial, time-boxed offers the picker can show ("Draft week: want
--                    more draft content until 24 Apr?"). Active rows are public.
-- feed_experiments   the knobs the feed exposes, assigned per visitor by hash. Running rows
--                    are public (the config is not sensitive); results are written back by
--                    the daily review.

create table if not exists public.feed_preferences (
  session_id  text primary key,
  players     text[]      not null default '{}',
  wants       text[]      not null default '{}',
  format      text        check (format in ('video', 'read', 'both')),
  follow      text,
  boosts      jsonb       not null default '[]'::jsonb,
  source      text        not null default 'picker',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.feed_preferences enable row level security;

create table if not exists public.feed_presets (
  slug                 text primary key,
  name                 text not null,
  blurb                text,
  entity_weights       jsonb not null default '{}'::jsonb,
  content_type_weights jsonb not null default '{}'::jsonb,
  active               boolean not null default true,
  updated_at           timestamptz not null default now()
);
alter table public.feed_presets enable row level security;
drop policy if exists anon_read_active on public.feed_presets;
create policy anon_read_active on public.feed_presets for select to anon, authenticated using (active);

insert into public.feed_presets (slug, name, blurb, entity_weights, content_type_weights) values
('toro', 'TORO''s picks', 'Skits, pranks, community days and the fun side of Texans football.',
 '{"theme:mascot": 1}'::jsonb,
 '{"mascot_skits": 1, "mascot": 1, "pranks": 0.8, "player_pranks": 0.8, "fun_trends": 0.7, "community": 0.9, "challenges": 0.6}'::jsonb)
on conflict (slug) do update set name = excluded.name, blurb = excluded.blurb,
  entity_weights = excluded.entity_weights, content_type_weights = excluded.content_type_weights, updated_at = now();

create table if not exists public.feed_boost_offers (
  key           text primary key,
  label         text not null,
  blurb         text,
  content_types text[] not null default '{}',
  keywords      text[] not null default '{}',
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  active        boolean not null default true,
  created_by    text,
  updated_at    timestamptz not null default now()
);
alter table public.feed_boost_offers enable row level security;
drop policy if exists anon_read_live on public.feed_boost_offers;
create policy anon_read_live on public.feed_boost_offers for select to anon, authenticated
  using (active and starts_at <= now() and ends_at > now());

create table if not exists public.feed_experiments (
  key         text primary key,
  hypothesis  text not null,
  metric      text not null,
  arms        jsonb not null,
  knobs       jsonb not null default '{}'::jsonb,
  traffic     numeric not null default 0.5 check (traffic > 0 and traffic <= 1),
  status      text not null default 'draft' check (status in ('draft', 'running', 'stopped', 'shipped')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  created_by  text,
  notes       text,
  result      jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.feed_experiments enable row level security;
drop policy if exists anon_read_running on public.feed_experiments;
create policy anon_read_running on public.feed_experiments for select to anon, authenticated
  using (status = 'running' and starts_at <= now() and (ends_at is null or ends_at > now()));

comment on table public.feed_preferences is 'Explicit fan preferences by pseudonymous session id. Service key only.';
comment on table public.feed_experiments is 'Feed experiments: arms is {arm: weight}, knobs is {arm: {knob: value}}. Running rows are public config.';
