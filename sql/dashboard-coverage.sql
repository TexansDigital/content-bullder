-- Fan knowledge dashboard (workstream 6). Read only: one SELECT, no migration.
-- Run by the dashboard artifact through the Supabase connector, project xisvulbabqsyxnlyuwcz.
-- Excluded everywhere: params.qa or params.automated true, the session of Adam, and any session id
-- containing smoketest, armcheck or test. Days are Houston days (America/Chicago).
-- A fan is their Eloqua GUID when a session carried one, else the pocket id of the session, so picks
-- copied onto a new session by the welcome card count once. No GUID, name or email leaves the query.
-- Of the clips fans actually watched each day (distinct YouTube clips on a card_view), how many we
-- can read a player, coach, staff member or theme from: by the alias tagger, or only by the model
-- pass (matched_on = 'model'). Opponent labels are left out: they come from the schedule.
with clean as (
  select e.session_id, e.event, e.video_id, e.params, e.at,
         (e.at at time zone 'America/Chicago')::date as day
  from public.feed_events e
  where coalesce(e.params->>'qa', '') <> 'true'
    and coalesce(e.params->>'automated', '') <> 'true'
    and coalesce(e.session_id, '') <> 'sess_1786805317298_00hak59zn'
    and coalesce(e.session_id, '') !~* '(smoketest|armcheck|test)'
),
viewed as (
  select distinct day, video_id from clean
  where event = 'card_view' and video_id is not null
    and day >= (now() at time zone 'America/Chicago')::date - 6
),
tags as (
  select video_id,
         bool_or(matched_on <> 'model') as by_alias,
         bool_or(matched_on = 'model') as by_model
  from public.feed_video_entities
  where entity_type in ('player', 'coach', 'staff', 'theme')
  group by video_id
)
select v.day::text as day,
  count(*) as clips_watched,
  count(*) filter (where t.by_alias or t.by_model) as clips_known,
  count(*) filter (where t.by_model and not t.by_alias) as clips_known_by_model
from viewed v
left join tags t on t.video_id = v.video_id
group by v.day
order by v.day
