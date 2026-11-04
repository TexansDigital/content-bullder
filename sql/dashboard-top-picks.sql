-- Fan knowledge dashboard (workstream 6). Read only: one SELECT, no migration.
-- Run by the dashboard artifact through the Supabase connector, project xisvulbabqsyxnlyuwcz.
-- Excluded everywhere: params.qa or params.automated true, the session of Adam, and any session id
-- containing smoketest, armcheck or test. Days are Houston days (America/Chicago).
-- A fan is their Eloqua GUID when a session carried one, else the pocket id of the session, so picks
-- copied onto a new session by the welcome card count once. No GUID, name or email leaves the query.
-- The five players most fans have picked, now and seven days ago. Player names come from the
-- alias dictionary (the longest tier 1 alias, as the feed shows it); they are public roster names, never the name of a fan.
with clean as (
  select e.session_id, e.event, e.video_id, e.params, e.at,
         (e.at at time zone 'America/Chicago')::date as day
  from public.feed_events e
  where coalesce(e.params->>'qa', '') <> 'true'
    and coalesce(e.params->>'automated', '') <> 'true'
    and coalesce(e.session_id, '') <> 'sess_1786805317298_00hak59zn'
    and coalesce(e.session_id, '') !~* '(smoketest|armcheck|test)'
),
guid_of as (
  select session_id, min(params->>'eloqua_guid') as guid
  from clean
  where event = 'identity' and params ? 'eloqua_guid'
  group by session_id
),
prefs as (
  select coalesce(g.guid, p.session_id) as fan, p.players, p.wants, p.going, p.watch,
         (p.created_at at time zone 'America/Chicago')::date as day, g.guid is not null as recognised
  from public.feed_preferences p
  left join guid_of g on g.session_id = p.session_id
  where coalesce(p.session_id, '') <> 'sess_1786805317298_00hak59zn'
    and coalesce(p.session_id, '') !~* '(smoketest|armcheck|test)'
    and (exists (select 1 from clean c where c.session_id = p.session_id)
         or not exists (select 1 from public.feed_events e where e.session_id = p.session_id))
),
picks as (
  select distinct fan, unnest(players) as slug, day from prefs
),
named as (
  select entity_slug, trim(replace(replace(replace(initcap(replace((array_agg(alias order by length(alias) desc, alias))[1], '.', '. ')), '.  ', '@'), '. ', '.'), '@', '. ')) as player
  from public.feed_entity_aliases where entity_type = 'player' and tier = 1 group by 1
)
select coalesce(n.player, initcap(replace(k.slug, '-', ' '))) as player,
  count(distinct k.fan) as fans,
  count(distinct k.fan) filter (where k.day <= (now() at time zone 'America/Chicago')::date - 7) as fans_7d_ago
from picks k
left join named n on n.entity_slug = k.slug
group by 1
order by fans desc, player
limit 5
