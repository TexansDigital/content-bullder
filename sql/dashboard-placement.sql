-- Fan knowledge dashboard (workstream 6). Read only: one SELECT, no migration.
-- Run by the dashboard artifact through the Supabase connector, project xisvulbabqsyxnlyuwcz.
-- Excluded everywhere: params.qa or params.automated true, the session of Adam, and any session id
-- containing smoketest, armcheck or test. Days are Houston days (America/Chicago).
-- A fan is their Eloqua GUID when a session carried one, else the pocket id of the session, so picks
-- copied onto a new session by the welcome card count once. No GUID, name or email leaves the query.
-- Feed sessions per placement per day for the last seven days, and how many of them were
-- recognised (the session carried an Eloqua GUID on its identity event). Only feed_load carries
-- feed_placement, so the sessions of a placement are the sessions of its feed_load events.
with clean as (
  select e.session_id, e.event, e.video_id, e.params, e.at,
         (e.at at time zone 'America/Chicago')::date as day
  from public.feed_events e
  where coalesce(e.params->>'qa', '') <> 'true'
    and coalesce(e.params->>'automated', '') <> 'true'
    and coalesce(e.session_id, '') <> 'sess_1786805317298_00hak59zn'
    and coalesce(e.session_id, '') !~* '(smoketest|armcheck|test)'
),
recognised as (
  select distinct session_id from clean where event = 'identity' and params ? 'eloqua_guid'
),
loads as (
  select distinct c.day, coalesce(nullif(c.params->>'feed_placement', ''), 'unknown') as placement, c.session_id
  from clean c
  where c.event = 'feed_load' and c.session_id is not null and c.day >= (now() at time zone 'America/Chicago')::date - 6
)
select l.day::text || ':' || l.placement as row_key, l.day::text as day, l.placement,
  count(distinct l.session_id) as sessions,
  count(distinct l.session_id) filter (where r.session_id is not null) as identified
from loads l
left join recognised r on r.session_id = l.session_id
group by l.day, l.placement
order by l.day, l.placement
