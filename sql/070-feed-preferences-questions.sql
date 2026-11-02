-- Two more one-tap questions and the fan's week.
--
-- going   "Going to a game this season?"  yes | maybe | no   (ticket intent, declared)
-- watch   "How do you watch?"             stadium | home | go    (pacing; see 080, which renamed the first value)
-- feed_week(sid)  what one fan watched in the last seven days: views, top players, top content
--                 types. Service key only; it reads feed_events for one session id.

alter table public.feed_preferences
  add column if not exists going text check (going in ('yes', 'maybe', 'no')),
  add column if not exists watch text check (watch in ('nrg', 'home', 'go'));

create or replace function public.feed_week(sid text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select e.video_id
    from public.feed_events e
    where e.session_id = sid
      and e.event = 'card_view'
      and e.video_id is not null
      and e.at > now() - interval '7 days'
  ),
  players as (
    select fe.entity_slug as slug, count(*) as n
    from v
    join public.feed_video_entities fe on fe.video_id = v.video_id and fe.entity_type = 'player'
    group by fe.entity_slug
    order by n desc
    limit 3
  ),
  types as (
    select t.content_type as type, count(*) as n
    from v
    join public.short_content_types t on t.video_id = v.video_id
    where t.content_type is not null
    group by t.content_type
    order by n desc
    limit 3
  )
  select jsonb_build_object(
    'views', (select count(*) from v),
    'players', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'n', n)) from players), '[]'::jsonb),
    'types', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'n', n)) from types), '[]'::jsonb)
  );
$$;

revoke all on function public.feed_week(text) from public, anon, authenticated;
grant execute on function public.feed_week(text) to service_role;

comment on function public.feed_week(text) is 'One fan''s last seven days, for the weekly "your week" card. Service key only.';
