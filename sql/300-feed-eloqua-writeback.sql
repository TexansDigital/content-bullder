-- 300: Eloqua writeback, the dry run. Workstream 2 (docs/workstreams.md), branch claude/eloqua-writeback.
--
-- The feed learns a fan's picks (feed_preferences) and, for about half of sessions, the Eloqua
-- visitor GUID the handshake passed (the identity event's params.eloqua_guid). Eloqua holds the
-- contact and sends the email. This migration joins the two, read only, so the sync Worker
-- (workers/eloqua-sync) can list what would be written to which contact field before any write.
--
-- feed_eloqua_candidates(lookback, lim)   one row per recognised GUID with something the fan told
--                                          us on purpose: picks, lanes, format, going, watch, follow,
--                                          live boosts, plus their last feed visit. Nothing personal:
--                                          the GUID is the only key and it never leaves this project.
-- feed_eloqua_writes                       the log of every planned and every actual write, one row
--                                          per contact field. status 'dry' until Adam says go.
--
-- Clean sessions only. A session is excluded when any of its events says qa or automated, when it
-- is Adam's own session, or when its id contains smoketest, armcheck or test. A fan's data is
-- never counted twice: the newest preference row across all of that GUID's sessions wins.
-- Picks on excluded_players are dropped here, the same way the feed drops them everywhere.

create table if not exists public.feed_eloqua_writes (
  id          bigserial   primary key,
  run_id      text        not null,
  guid        text        not null,
  contact_id  text,
  field       text        not null,
  value       text,
  previous    text,
  status      text        not null check (status in ('dry', 'written', 'unchanged', 'skipped', 'failed')),
  reason      text,
  at          timestamptz not null default now()
);
create index if not exists feed_eloqua_writes_run_idx on public.feed_eloqua_writes (run_id, at desc);
create index if not exists feed_eloqua_writes_guid_idx on public.feed_eloqua_writes (guid, field, at desc);
alter table public.feed_eloqua_writes enable row level security;
-- No anon policy: only the service key (the sync Worker) reads or writes this table.

create or replace function public.feed_eloqua_candidates(lookback interval default interval '90 days', lim integer default 500)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with noisy as (
    -- Any session that ever marked itself as ours is out, whole, not event by event.
    select distinct e.session_id
    from public.feed_events e
    where e.at > now() - lookback
      and (coalesce(e.params->>'qa', 'false') = 'true' or coalesce(e.params->>'automated', 'false') = 'true')
  ),
  ident as (
    select distinct e.session_id, upper(e.params->>'eloqua_guid') as guid
    from public.feed_events e
    where e.event = 'identity'
      and e.at > now() - lookback
      and e.params->>'eloqua_guid' ~* '^[0-9a-f]{32}$'
      and e.session_id <> 'sess_1786805317298_00hak59zn'
      and e.session_id !~* '(smoketest|armcheck|test)'
      and not exists (select 1 from noisy n where n.session_id = e.session_id)
  ),
  excluded as (
    select array_agg(s) as slugs from public.feed_excluded_slugs() s
  ),
  prefs as (
    select i.guid, p.session_id, p.updated_at, p.source, p.format, p.going, p.watch, p.follow,
           -- picks that are still allowed, in the order the fan gave them
           coalesce((select array_agg(x order by o) from unnest(p.players) with ordinality as u(x, o)
                     where not (x = any (coalesce((select slugs from excluded), '{}')))), '{}') as players,
           p.wants,
           -- only boosts whose date has not passed
           coalesce((select jsonb_agg(b) from jsonb_array_elements(p.boosts) b
                     where (b->>'until') is null or (b->>'until')::timestamptz > now()), '[]'::jsonb) as boosts,
           row_number() over (partition by i.guid order by p.updated_at desc) as rn
    from ident i
    join public.feed_preferences p on p.session_id = i.session_id
  ),
  latest as (
    select * from prefs
    where rn = 1
      and (cardinality(players) > 0 or cardinality(wants) > 0 or format is not null or going is not null
           or watch is not null or follow is not null or jsonb_array_length(boosts) > 0)
  ),
  visits as (
    select i.guid, count(distinct i.session_id) as sessions, max(e.at) as last_visit, min(e.at) as first_visit
    from ident i
    join public.feed_events e on e.session_id = i.session_id and e.event = 'feed_load'
    group by i.guid
  ),
  names as (
    -- One display alias per slug, the one with initials when there is one ("c.j. stroud").
    select distinct on (a.entity_slug) a.entity_slug, a.alias
    from public.feed_entity_aliases a
    where a.entity_type = 'player' and a.tier = 1
    order by a.entity_slug, (position('.' in a.alias) > 0) desc, length(a.alias) desc
  ),
  rows_ as (
    select l.guid, l.session_id, l.updated_at, l.source, l.format, l.going, l.watch, l.follow, l.players, l.wants, l.boosts,
           (select array_agg(coalesce(n.alias, replace(x, '-', ' ')) order by o)
              from unnest(l.players) with ordinality as u(x, o) left join names n on n.entity_slug = x) as players_named,
           v.sessions, v.last_visit, v.first_visit
    from latest l
    left join visits v on v.guid = l.guid
    order by l.updated_at desc
    limit lim
  )
  select jsonb_build_object(
    'generated_at', now(),
    'lookback_days', extract(epoch from lookback) / 86400,
    'recognised_guids', (select count(distinct guid) from ident),
    'recognised_sessions', (select count(distinct session_id) from ident),
    'excluded_sessions', (select count(*) from noisy),
    'candidates_total', (select count(*) from latest),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object(
        'guid', r.guid,
        'session_id', r.session_id,
        'pref_updated_at', r.updated_at,
        'pref_source', r.source,
        'players', to_jsonb(r.players),
        'players_named', to_jsonb(coalesce(r.players_named, '{}'::text[])),
        'wants', to_jsonb(r.wants),
        'format', r.format,
        'going', r.going,
        'watch', r.watch,
        'follow', r.follow,
        'boosts', r.boosts,
        'sessions', coalesce(r.sessions, 0),
        'first_visit', r.first_visit,
        'last_visit', r.last_visit
      ) order by r.updated_at desc) from rows_ r), '[]'::jsonb)
  );
$$;

revoke all on function public.feed_eloqua_candidates(interval, integer) from public, anon, authenticated;
grant execute on function public.feed_eloqua_candidates(interval, integer) to service_role;

comment on table public.feed_eloqua_writes is 'Every planned (dry) and actual write of a feed pick onto an Eloqua contact, one row per field. Service key only.';
comment on function public.feed_eloqua_candidates(interval, integer) is 'Recognised fans (by Eloqua GUID) with saved picks, newest preference per GUID, clean sessions only. Service key only.';
