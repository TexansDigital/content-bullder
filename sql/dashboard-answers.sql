-- Fan knowledge dashboard (workstream 6). Read only: one SELECT, no migration.
-- Run by the dashboard artifact through the Supabase connector, project xisvulbabqsyxnlyuwcz.
-- Excluded everywhere: params.qa or params.automated true, the session of Adam, and any session id
-- containing smoketest, armcheck or test. Days are Houston days (America/Chicago).
-- A fan is their Eloqua GUID when a session carried one, else the pocket id of the session, so picks
-- copied onto a new session by the welcome card count once. No GUID, name or email leaves the query.
-- Every option of the two one-tap questions, with how many fans chose it (zero rows kept).
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
options(question, answer, label, ord) as (
  values ('going', 'yes', 'Yes', 1), ('going', 'maybe', 'Maybe', 2), ('going', 'no', 'Not this year', 3),
         ('watch', 'stadium', 'At Reliant Stadium', 1), ('watch', 'home', 'At home', 2), ('watch', 'go', 'On the go', 3)
),
given as (
  select distinct fan, 'going' as question, going as answer from prefs where going is not null
  union all
  select distinct fan, 'watch', watch from prefs where watch is not null
)
select o.question || ':' || o.answer as option_key, o.question, o.label,
  count(distinct g.fan) as fans
from options o
left join given g on g.question = o.question and g.answer = o.answer
group by o.question, o.answer, o.label, o.ord
order by o.question, o.ord
