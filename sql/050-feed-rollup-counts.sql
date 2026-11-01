-- feed_rollup_profiles counted every event for a session and ADDED that count on each
-- nightly run. With a two-day lookback a session seen on consecutive nights was counted twice,
-- and the first scheduled run doubled every profile (173 events became 346). The count now
-- covers card events only (those that name a video, which are the ones the weights are built
-- from) and each run recomputes it from the table instead of accumulating.
create or replace function public.feed_rollup_profiles(lookback interval default '2 days'::interval)
returns integer
language plpgsql
as $function$
declare
  touched integer;
begin
  with recent as (
    select coalesce(session_id, device_id) as who
    from public.feed_events
    where at >= now() - lookback and coalesce(session_id, device_id) is not null
    group by 1
  ),
  scored as (
    select coalesce(e.session_id, e.device_id) as who,
           ve.entity_type || ':' || ve.entity_slug as key,
           sum(
             case e.event
               when 'card_share'         then 2.0
               when 'card_like'          then 1.5
               when 'card_action'        then 1.5
               when 'card_play'          then 1.5
               when 'card_play_complete' then 1.5
               when 'card_complete'      then 1.0
               when 'card_play_close'    then 0.3
               when 'card_autoplay'      then 0.2
               when 'card_view'          then 0.3
               when 'card_exit'          then 0.1
               when 'card_unlike'        then -1.5
               else 0 end
             * ve.confidence
             * power(0.5, extract(epoch from (now() - e.at)) / (30 * 86400))
           ) as score
    from public.feed_events e
    join recent r on r.who = coalesce(e.session_id, e.device_id)
    join public.feed_video_entities ve on ve.video_id = e.video_id
    where e.video_id is not null
    group by 1, 2
  ),
  ct as (
    select coalesce(e.session_id, e.device_id) as who, sct.content_type as key,
           sum(case e.event when 'card_complete' then 1.0 when 'card_like' then 1.5
                            when 'card_play' then 1.5 when 'card_play_complete' then 1.5
                            when 'card_autoplay' then 0.2
                            when 'card_view' then 0.3 when 'card_exit' then 0.1 else 0 end
               * power(0.5, extract(epoch from (now() - e.at)) / (30 * 86400))) as score
    from public.feed_events e
    join recent r on r.who = coalesce(e.session_id, e.device_id)
    join public.short_content_types sct on sct.video_id = e.video_id
    where e.video_id is not null
    group by 1, 2
  ),
  ew as (
    select who, jsonb_object_agg(key, round((score / mx)::numeric, 3)) as weights
    from (select who, key, score, max(score) over (partition by who) as mx from scored where score > 0) z
    group by who
  ),
  cw as (
    select who, jsonb_object_agg(key, round((score / mx)::numeric, 3)) as weights
    from (select who, key, score, max(score) over (partition by who) as mx from ct where score > 0) z
    group by who
  ),
  stats as (
    select coalesce(e.session_id, e.device_id) as who,
           count(*) filter (where e.video_id is not null) as n,
           min(e.at) as first_at, max(e.at) as last_at
    from public.feed_events e join recent r on r.who = coalesce(e.session_id, e.device_id)
    group by 1
  )
  insert into public.feed_profiles (session_id, entity_weights, content_type_weights, events, first_seen, last_seen, updated_at)
  select s.who, coalesce(ew.weights, '{}'::jsonb), coalesce(cw.weights, '{}'::jsonb), s.n, s.first_at, s.last_at, now()
  from stats s
  left join ew on ew.who = s.who
  left join cw on cw.who = s.who
  on conflict (session_id) do update
    set entity_weights       = excluded.entity_weights,
        content_type_weights = excluded.content_type_weights,
        events               = excluded.events,
        first_seen           = least(public.feed_profiles.first_seen, excluded.first_seen),
        last_seen            = greatest(public.feed_profiles.last_seen, excluded.last_seen),
        updated_at           = now();
  get diagnostics touched = row_count;
  return touched;
end $function$;

comment on function public.feed_rollup_profiles(interval) is
  'Rebuilds feed_profiles for every session seen within lookback. events = card events behind the weights, recomputed each run.';
