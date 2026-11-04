-- Fan knowledge dashboard (workstream 6). Read only: one SELECT, no migration.
-- Run by the dashboard artifact through the Supabase connector, project xisvulbabqsyxnlyuwcz.
-- Excluded everywhere: params.qa or params.automated true, the session of Adam, and any session id
-- containing smoketest, armcheck or test. Days are Houston days (America/Chicago).
-- A fan is their Eloqua GUID when a session carried one, else the pocket id of the session, so picks
-- copied onto a new session by the welcome card count once. No GUID, name or email leaves the query.
-- One row per day for the last seven days: what we know, cumulative to the end of that day.
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
first_seen as (
  select params->>'eloqua_guid' as guid, min(day) as day
  from clean where event = 'identity' and params ? 'eloqua_guid' group by 1
),
days as (
  select d::date as day
  from generate_series((now() at time zone 'America/Chicago')::date - 6,
                       (now() at time zone 'America/Chicago')::date, interval '1 day') d
)
select d.day::text as day,
  (select count(*) from first_seen f where f.day <= d.day) as recognised_fans,
  (select count(*) from first_seen f where f.day = d.day) as recognised_new,
  (select count(distinct fan) from prefs p where p.day <= d.day
     and (cardinality(p.players) > 0 or cardinality(p.wants) > 0)) as fans_with_pick,
  (select count(distinct fan) from prefs p where p.day < d.day
     and (cardinality(p.players) > 0 or cardinality(p.wants) > 0)) as fans_with_pick_before,
  (select count(distinct fan) from prefs p where p.day <= d.day and p.recognised
     and (cardinality(p.players) > 0 or cardinality(p.wants) > 0)) as recognised_with_pick,
  (select count(distinct fan) from prefs p where p.day <= d.day and p.going is not null) as going_answers,
  (select count(distinct fan) from prefs p where p.day <= d.day and p.watch is not null) as watch_answers,
  (select min(day)::text from clean) as tracking_since
from days d
order by d.day
