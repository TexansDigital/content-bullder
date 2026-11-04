-- 600: email entry. Recognised feed sessions from a club email, per day.
--
-- Reads two events the feed sends once handshake v5 and proposals/email-entry/feed.diff are live:
--   identity    carries email_id, email_name, email_campaign, email_asset (Performance consent)
--               and email_elq (Targeting consent only) when the fan arrived from a club email
--   who_result  one per session with an Eloqua GUID: who_known, who_via (history|eloqua|none),
--               who_contact (Eloqua has tied the visitor to a contact), plus the same email fields
--
-- A session is "from email" when either event names an email. It is "recognised" when its
-- who_result says known. Days are Houston days (America/Chicago).
--
-- Never counted: our own traffic (params.qa or params.automated true), Adam's session
-- sess_1786805317298_00hak59zn, and session ids containing smoketest, armcheck or test.
--
-- Service key only, like every other report over feed_events.

create or replace function public.feed_email_entry_sessions(days int default 14)
returns table(
  session_id text, day date, from_email boolean, email_id text, email_name text, email_campaign text,
  has_guid boolean, asked boolean, recognised boolean, via text, contact boolean
)
language sql
stable
as $$
  with ev as (
    select e.session_id, e.event, e.params, e.at
    from public.feed_events e
    where e.at > now() - make_interval(days => greatest(days, 1))
      and e.event in ('identity', 'who_result')
      and coalesce(e.params->>'qa', 'false') <> 'true'
      and coalesce(e.params->>'automated', 'false') <> 'true'
      and e.session_id <> 'sess_1786805317298_00hak59zn'
      and e.session_id !~* '(smoketest|armcheck|test)'
  )
  select ev.session_id,
         (min(ev.at) at time zone 'America/Chicago')::date,
         bool_or(ev.params ? 'email_id' or ev.params ? 'email_campaign' or coalesce(ev.params->>'email_elq', 'false') = 'true'),
         max(ev.params->>'email_id'),
         max(ev.params->>'email_name'),
         max(ev.params->>'email_campaign'),
         bool_or(ev.event = 'identity' and ev.params ? 'eloqua_guid'),
         bool_or(ev.event = 'who_result'),
         coalesce(bool_or(ev.event = 'who_result' and ev.params->>'who_known' = 'true'), false),
         max(ev.params->>'who_via') filter (where ev.event = 'who_result'),
         coalesce(bool_or(ev.event = 'who_result' and ev.params->>'who_contact' = 'true'), false)
  from ev
  group by ev.session_id;
$$;
revoke execute on function public.feed_email_entry_sessions(int) from anon, authenticated;

-- The daily line for the review: from email against everything else, same day, same rules.
create or replace function public.feed_email_entry_daily(days int default 14)
returns table(
  day date,
  email_sessions bigint, email_with_guid bigint, email_recognised bigint, email_contact bigint,
  other_sessions bigint, other_recognised bigint
)
language sql
stable
as $$
  select s.day,
         count(*) filter (where s.from_email),
         count(*) filter (where s.from_email and s.has_guid),
         count(*) filter (where s.from_email and s.recognised),
         count(*) filter (where s.from_email and s.contact),
         count(*) filter (where not s.from_email),
         count(*) filter (where not s.from_email and s.recognised)
  from public.feed_email_entry_sessions(days) s
  group by s.day
  order by s.day;
$$;
revoke execute on function public.feed_email_entry_daily(int) from anon, authenticated;

-- Which email brought the recognised fans: one row per email, for the same window.
create or replace function public.feed_email_entry_by_email(days int default 14)
returns table(email_id text, email_name text, sessions bigint, recognised bigint, contact bigint, first_day date, last_day date)
language sql
stable
as $$
  select s.email_id, max(s.email_name), count(*), count(*) filter (where s.recognised), count(*) filter (where s.contact), min(s.day), max(s.day)
  from public.feed_email_entry_sessions(days) s
  where s.from_email
  group by s.email_id
  order by count(*) desc;
$$;
revoke execute on function public.feed_email_entry_by_email(int) from anon, authenticated;
