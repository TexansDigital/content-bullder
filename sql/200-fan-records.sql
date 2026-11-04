-- Workstream 1: the fan record. One row per recognised fan, holding only what the feed learned.
--
-- A fan is keyed by the Eloqua visitor GUID when one was seen on any of their sessions
-- (fan_key 'guid:<32 hex>'), else by the pocket session id ('pocket:sess_...'). The record carries
-- picks, lanes, the two answers, the players and content types they finish most, how often they
-- come, where they come in from, and the ticket clicks and purchases that reach them through the
-- GUID. Never a name, never an email: the Eloqua contact id is the only thing from Eloqua.
--
-- Tables
--   fan_ticket_signals   staging, written nightly by workers/fan-record from D1 ht-attribution:
--                        clicks and attributed purchases per GUID and per pocket id
--   fan_eloqua_contacts  staging, written by the same Worker: which GUIDs Eloqua knows, and the
--                        contact id. Nothing else from the contact.
--   fan_records          the rollup. Rebuilt nightly by fan_rollup_records() at 08:50 UTC, after the
--                        profile rollup (08:25), the prune (08:40) and the Worker's load (08:45).
-- Functions
--   fan_rollup_records()           rebuild every record from clean feed events
--   fan_record(key)                one record as jsonb, by GUID (any case) or pocket id
--   fan_records_masked(n)          the first n records with ids masked, for a human to read
--   fan_records_report()           the counts for the daily review
--
-- Our own traffic never becomes fan data: events with params.qa or params.automated, Adam's
-- session sess_1786805317298_00hak59zn, session ids containing smoketest, armcheck or test, and
-- any GUID ever seen on one of those sessions (that is the same person on a clean load), and any
-- session sending more than one card event a second (a burst the Worker did not mark).
--
-- Retention follows the feed's: a record not seen for 90 days is deleted, GUID and all.
--
-- All four objects are service-role only. anon and authenticated can read nothing here.

create table if not exists public.fan_ticket_signals (
  key_type            text        not null check (key_type in ('guid', 'pocket')),
  key                 text        not null,                  -- lower-case GUID, or the pocket id
  clicks              integer     not null default 0,        -- ticket clicks in D1 clicks
  click_first_at      timestamptz,
  click_last_at       timestamptz,
  pages               jsonb       not null default '[]'::jsonb,  -- [{page, n}] the pages the clicks came from, top 5
  games               jsonb       not null default '[]'::jsonb,  -- [{event_id, opponent, n}] the games clicked, top 5
  purchases           integer     not null default 0,        -- attributed at confidence >= 0.75 (strong or medium)
  purchases_weak      integer     not null default 0,        -- attributed below 0.75 (the aggregate ip/ua day match)
  purchase_total      numeric(12,2) not null default 0,
  purchase_total_weak numeric(12,2) not null default 0,
  purchase_last_at    timestamptz,
  loaded_at           timestamptz not null default now(),
  primary key (key_type, key)
);

create table if not exists public.fan_eloqua_contacts (
  eloqua_guid text        primary key,                       -- lower-case
  contact_id  text,                                          -- Eloqua contact id when the visitor resolves
  known       boolean     not null default false,
  checked_at  timestamptz not null default now()
);

create table if not exists public.fan_records (
  fan_key           text        primary key,                 -- 'guid:<32 hex>' or 'pocket:<pocket id>'
  eloqua_guid       text,
  pocket_ids        text[]      not null default '{}',       -- every pocket session id this fan was seen on
  eloqua_contact_id text,
  eloqua_known      boolean,                                 -- null until the Worker has asked Eloqua
  -- what they told us
  picks             text[]      not null default '{}',       -- player slugs, latest save with picks
  lanes             text[]      not null default '{}',       -- wants
  format            text,
  follow            text,
  going             text,                                    -- yes | maybe | no
  watch             text,                                    -- stadium | home | go
  picks_source      text,
  picks_at          timestamptz,
  -- what they showed us
  top_players       jsonb       not null default '[]'::jsonb, -- [{slug, w}] players in what they watched, weighted by how far they went, top 5
  top_content_types jsonb       not null default '[]'::jsonb, -- [{type, w}] top 3
  sessions          integer     not null default 0,
  days_active       integer     not null default 0,          -- distinct days (America/Chicago) with an event
  first_seen        timestamptz,
  last_seen         timestamptz,
  card_events       integer     not null default 0,          -- events that name a video
  completes         integer     not null default 0,
  likes             integer     not null default 0,
  shares            integer     not null default 0,
  reads             integer     not null default 0,          -- story and gallery cards finished or opened
  placements        jsonb       not null default '{}'::jsonb, -- {news: 3, roster: 1} feed_load by feed_placement
  -- what the ticket pixels know, through the GUID (and the pocket id once D1 carries it)
  clicks            integer     not null default 0,
  click_pages       jsonb       not null default '[]'::jsonb,
  games             jsonb       not null default '[]'::jsonb,
  click_last_at     timestamptz,
  purchases         integer     not null default 0,
  purchases_weak    integer     not null default 0,
  purchase_total    numeric(12,2) not null default 0,
  purchase_last_at  timestamptz,
  updated_at        timestamptz not null default now()
);
create unique index if not exists fan_records_guid_idx on public.fan_records (eloqua_guid) where eloqua_guid is not null;
create index if not exists fan_records_pocket_idx on public.fan_records using gin (pocket_ids);
create index if not exists fan_records_last_seen_idx on public.fan_records (last_seen desc);

alter table public.fan_ticket_signals  enable row level security;
alter table public.fan_eloqua_contacts enable row level security;
alter table public.fan_records         enable row level security;
revoke all on public.fan_ticket_signals, public.fan_eloqua_contacts, public.fan_records from anon, authenticated;

-- Our own sessions, by id. The GUID rule lives in the rollup, where the identity events are.
create or replace function public.fan_excluded_session(sid text) returns boolean
language sql immutable as $$
  select sid is null
      or sid = 'sess_1786805317298_00hak59zn'
      or sid ~* '(smoketest|armcheck|test)';
$$;

create or replace function public.fan_rollup_records() returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  drop table if exists _fan_ev, _fan_bad_guid, _fan_sid;
  -- 1. Clean events: pocket sessions only, none of our own traffic.
  create temp table _fan_ev on commit drop as
    select e.id, e.session_id, e.event, e.card_id, e.video_id, e.params, e.at
    from public.feed_events e
    where e.session_id ~ '^sess_'
      and coalesce(e.params->>'qa', '') not in ('true', '1')
      and coalesce(e.params->>'automated', '') not in ('true', '1')
      and not public.fan_excluded_session(e.session_id);

  -- 2. GUIDs seen on our own sessions are ours too, whichever device they come back on.
  create temp table _fan_bad_guid on commit drop as
    select distinct lower(e.params->>'eloqua_guid') as guid
    from public.feed_events e
    where e.event = 'identity'
      and e.params->>'eloqua_guid' ~* '^[0-9a-f]{32}$'
      and (public.fan_excluded_session(e.session_id)
           or coalesce(e.params->>'qa', '') in ('true', '1')
           or coalesce(e.params->>'automated', '') in ('true', '1'));

  delete from _fan_ev
  where session_id in (
    select session_id from _fan_ev
    where event = 'identity' and lower(params->>'eloqua_guid') in (select guid from _fan_bad_guid));

  -- 2b. Bursts the Worker did not mark: more than one card event a second across the session
  -- (4 Nov 2026: one session sent 106 shares and 79 plays in 35 seconds, unflagged).
  delete from _fan_ev
  where session_id in (
    select session_id from _fan_ev
    group by session_id
    having count(*) filter (where video_id is not null or card_id is not null)
           > greatest(60, extract(epoch from max(at) - min(at))));

  -- 3. One GUID per session: the latest identity event that carried one.
  create temp table _fan_sid on commit drop as
    select s.session_id,
           g.guid,
           coalesce('guid:' || g.guid, 'pocket:' || s.session_id) as fan_key
    from (select distinct session_id from _fan_ev) s
    left join (
      select distinct on (session_id) session_id, lower(params->>'eloqua_guid') as guid
      from _fan_ev
      where event = 'identity' and params->>'eloqua_guid' ~* '^[0-9a-f]{32}$'
      order by session_id, at desc
    ) g using (session_id);

  -- 4. Build and upsert.
  with ev as (
    select f.fan_key, f.guid, e.*
    from _fan_ev e join _fan_sid f using (session_id)
  ),
  stats as (
    select fan_key,
           min(guid)                                                   as guid,
           array_agg(distinct session_id)                              as pocket_ids,
           count(distinct session_id)                                  as sessions,
           count(distinct (at at time zone 'America/Chicago')::date)   as days_active,
           min(at) as first_seen, max(at) as last_seen,
           count(*) filter (where video_id is not null)                as card_events,
           count(*) filter (where event = 'card_complete')             as completes,
           count(*) filter (where event = 'card_like')                 as likes,
           count(*) filter (where event = 'card_share')                as shares,
           count(*) filter (where card_id like 'pk-%' and event in ('card_complete', 'card_action', 'card_source_open')) as reads
    from ev group by fan_key
  ),
  placements as (
    select fan_key, jsonb_object_agg(p, n) as j
    from (select fan_key, coalesce(nullif(params->>'feed_placement', ''), 'feed') as p, count(*) as n
          from ev where event = 'feed_load' group by 1, 2) z
    group by fan_key
  ),
  prefs as (
    select distinct on (f.fan_key) f.fan_key,
           array(select x from unnest(p.players) x where x not in (select public.feed_excluded_slugs())) as picks,
           p.wants, p.format, p.follow, p.going, p.watch, p.source, p.updated_at
    from public.feed_preferences p join _fan_sid f using (session_id)
    order by f.fan_key, (cardinality(p.players) > 0) desc, p.updated_at desc
  ),
  -- What they finish, read from the events themselves rather than feed_profiles: on 4 Nov the
  -- profiles named a player for 1 recognised fan, the events for 12. Same weights as
  -- feed_rollup_profiles, without the decay (the record is a fact sheet, not a ranking).
  scored as (
    select ev.fan_key, ev.video_id,
           case ev.event when 'card_share' then 2.0 when 'card_like' then 1.5 when 'card_action' then 1.5
                         when 'card_play' then 1.5 when 'card_play_complete' then 1.5 when 'card_complete' then 1.0
                         when 'card_play_close' then 0.3 when 'card_autoplay' then 0.2 when 'card_view' then 0.3
                         when 'card_exit' then 0.1 when 'card_unlike' then -1.5 else 0 end as w
    from ev where ev.video_id is not null
  ),
  tp as (
    select fan_key, jsonb_agg(jsonb_build_object('slug', slug, 'w', w) order by w desc) as j
    from (
      select fan_key, slug, w, row_number() over (partition by fan_key order by w desc, slug) as rn
      from (
        select sc.fan_key, fe.entity_slug as slug, round(sum(sc.w * fe.confidence)::numeric, 2) as w
        from scored sc
        join public.feed_video_entities fe on fe.video_id = sc.video_id and fe.entity_type = 'player'
        where fe.entity_slug not in (select public.feed_excluded_slugs())
        group by 1, 2
      ) z where w > 0
    ) r where rn <= 5
    group by fan_key
  ),
  tc as (
    select fan_key, jsonb_agg(jsonb_build_object('type', t, 'w', w) order by w desc) as j
    from (
      select fan_key, t, w, row_number() over (partition by fan_key order by w desc, t) as rn
      from (
        select sc.fan_key, ct.content_type as t, round(sum(sc.w)::numeric, 2) as w
        from scored sc
        join public.short_content_types ct on ct.video_id = sc.video_id
        where ct.content_type is not null
        group by 1, 2
      ) z where w > 0
    ) r where rn <= 3
    group by fan_key
  ),
  keys as (
    select distinct fan_key, 'guid'::text as key_type, guid as key from _fan_sid where guid is not null
    union
    select distinct fan_key, 'pocket', session_id from _fan_sid
  ),
  tk as (
    select k.fan_key,
           sum(t.clicks)                                           as clicks,
           (array_agg(t.pages order by t.clicks desc))[1]          as pages,
           (array_agg(t.games order by t.clicks desc))[1]          as games,
           max(t.click_last_at)                                    as click_last_at,
           sum(t.purchases)                                        as purchases,
           sum(t.purchases_weak)                                   as purchases_weak,
           sum(t.purchase_total)                                   as purchase_total,
           max(t.purchase_last_at)                                 as purchase_last_at
    from keys k join public.fan_ticket_signals t on t.key_type = k.key_type and t.key = k.key
    group by k.fan_key
  )
  insert into public.fan_records as r (
    fan_key, eloqua_guid, pocket_ids, eloqua_contact_id, eloqua_known,
    picks, lanes, format, follow, going, watch, picks_source, picks_at,
    top_players, top_content_types,
    sessions, days_active, first_seen, last_seen, card_events, completes, likes, shares, reads, placements,
    clicks, click_pages, games, click_last_at, purchases, purchases_weak, purchase_total, purchase_last_at, updated_at)
  select s.fan_key, s.guid, s.pocket_ids, c.contact_id, c.known,
         coalesce(p.picks, '{}'), coalesce(p.wants, '{}'), p.format, p.follow, p.going, p.watch, p.source, p.updated_at,
         coalesce(tp.j, '[]'::jsonb), coalesce(tc.j, '[]'::jsonb),
         s.sessions, s.days_active, s.first_seen, s.last_seen, s.card_events, s.completes, s.likes, s.shares, s.reads,
         coalesce(pl.j, '{}'::jsonb),
         coalesce(tk.clicks, 0), coalesce(tk.pages, '[]'::jsonb), coalesce(tk.games, '[]'::jsonb), tk.click_last_at,
         coalesce(tk.purchases, 0), coalesce(tk.purchases_weak, 0), coalesce(tk.purchase_total, 0), tk.purchase_last_at,
         now()
  from stats s
  left join prefs p on p.fan_key = s.fan_key
  left join tp on tp.fan_key = s.fan_key
  left join tc on tc.fan_key = s.fan_key
  left join placements pl on pl.fan_key = s.fan_key
  left join tk on tk.fan_key = s.fan_key
  left join public.fan_eloqua_contacts c on c.eloqua_guid = s.guid
  on conflict (fan_key) do update set
    eloqua_guid = excluded.eloqua_guid, pocket_ids = excluded.pocket_ids,
    eloqua_contact_id = excluded.eloqua_contact_id, eloqua_known = excluded.eloqua_known,
    picks = excluded.picks, lanes = excluded.lanes, format = excluded.format, follow = excluded.follow,
    going = excluded.going, watch = excluded.watch, picks_source = excluded.picks_source, picks_at = excluded.picks_at,
    top_players = excluded.top_players, top_content_types = excluded.top_content_types,
    sessions = excluded.sessions, days_active = excluded.days_active,
    first_seen = least(r.first_seen, excluded.first_seen), last_seen = greatest(r.last_seen, excluded.last_seen),
    card_events = excluded.card_events, completes = excluded.completes, likes = excluded.likes, shares = excluded.shares,
    reads = excluded.reads, placements = excluded.placements,
    clicks = excluded.clicks, click_pages = excluded.click_pages, games = excluded.games, click_last_at = excluded.click_last_at,
    purchases = excluded.purchases, purchases_weak = excluded.purchases_weak, purchase_total = excluded.purchase_total,
    purchase_last_at = excluded.purchase_last_at, updated_at = now();
  get diagnostics touched = row_count;

  -- 5. A pocket-keyed record whose session now belongs to a GUID record is that record.
  delete from public.fan_records r
  where r.fan_key like 'pocket:%'
    and exists (select 1 from public.fan_records g
                where g.fan_key like 'guid:%' and g.pocket_ids @> array[substr(r.fan_key, 8)]);

  -- 6. Our own traffic never stays in the table, even if it was recognised late.
  delete from public.fan_records r
  where (r.fan_key like 'pocket:%' and public.fan_excluded_session(substr(r.fan_key, 8)))
     or r.eloqua_guid in (select guid from _fan_bad_guid);

  -- 7. Retention: the GUID is kept 90 days, like every feed event (decided 2 Nov 2026).
  delete from public.fan_records r where r.last_seen < now() - interval '90 days';

  return touched;
end $$;

comment on function public.fan_rollup_records() is
  'Rebuilds fan_records from clean feed events, feed_preferences, feed_video_entities, short_content_types, fan_ticket_signals and fan_eloqua_contacts. Nightly 08:50 UTC.';

-- One fan, by GUID (any case) or pocket id. Service role only.
create or replace function public.fan_record(key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(r)
  from public.fan_records r
  where (key ~* '^[0-9a-f]{32}$' and r.eloqua_guid = lower(key))
     or r.pocket_ids @> array[key]
  order by (r.eloqua_guid is not null) desc
  limit 1;
$$;

-- The first n records a person can read: ids masked, the signals in full.
create or replace function public.fan_records_masked(n integer default 10)
returns table (
  fan text, pockets integer, eloqua text, picks text[], lanes text[], going text, watch text,
  top_players text, top_types text, sessions integer, days integer, first_seen date, last_seen date,
  card_events integer, completes integer, reads integer, placements jsonb,
  clicks integer, games text, purchases integer, purchases_weak integer, purchase_total numeric)
language sql stable security definer set search_path = public as $$
  select case when r.eloqua_guid is not null then 'guid ' || left(r.eloqua_guid, 4) || '…' || right(r.eloqua_guid, 4)
              else 'pocket …' || right(r.fan_key, 4) end,
         cardinality(r.pocket_ids),
         case when r.eloqua_known is null then 'not asked' when r.eloqua_known then 'contact' else 'unknown' end,
         r.picks, r.lanes, r.going, r.watch,
         (select string_agg(x->>'slug' || ' ' || (x->>'w'), ', ') from jsonb_array_elements(r.top_players) x),
         (select string_agg(x->>'type' || ' ' || (x->>'w'), ', ') from jsonb_array_elements(r.top_content_types) x),
         r.sessions, r.days_active, r.first_seen::date, r.last_seen::date,
         r.card_events, r.completes, r.reads, r.placements,
         r.clicks,
         (select string_agg(x->>'opponent' || ' ×' || (x->>'n'), ', ') from jsonb_array_elements(r.games) x),
         r.purchases, r.purchases_weak, r.purchase_total
  from public.fan_records r
  order by (cardinality(r.picks) > 0) desc, r.card_events desc, r.last_seen desc
  limit n;
$$;

-- The counts for the daily review.
create or replace function public.fan_records_report() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'records',           count(*),
    'by_guid',           count(*) filter (where eloqua_guid is not null),
    'by_pocket_only',    count(*) filter (where eloqua_guid is null),
    'with_picks',        count(*) filter (where cardinality(picks) > 0),
    'with_answer',       count(*) filter (where going is not null or watch is not null),
    'with_top_player',   count(*) filter (where top_players <> '[]'::jsonb),
    'returning',         count(*) filter (where days_active > 1),
    'eloqua_contacts',   count(*) filter (where eloqua_known),
    'eloqua_asked',      count(*) filter (where eloqua_known is not null),
    'with_clicks',       count(*) filter (where clicks > 0),
    'with_purchases',    count(*) filter (where purchases > 0),
    'with_weak_purchases', count(*) filter (where purchases_weak > 0),
    'updated_at',        max(updated_at))
  from public.fan_records;
$$;

revoke all on function public.fan_rollup_records() from public, anon, authenticated;
revoke all on function public.fan_record(text) from public, anon, authenticated;
revoke all on function public.fan_records_masked(integer) from public, anon, authenticated;
revoke all on function public.fan_records_report() from public, anon, authenticated;
grant execute on function public.fan_rollup_records() to service_role;
grant execute on function public.fan_record(text) to service_role;
grant execute on function public.fan_records_masked(integer) to service_role;
grant execute on function public.fan_records_report() to service_role;

-- Nightly, after the profile rollup (08:25), the prune (08:40) and the Worker's D1 load (08:45).
do $$
begin
  perform cron.unschedule('fan_rollup_records_nightly');
exception when others then null;
end $$;
select cron.schedule('fan_rollup_records_nightly', '50 8 * * *', $$select public.fan_rollup_records()$$);
