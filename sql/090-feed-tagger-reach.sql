-- 090: the tagger reaches every clip the feed serves, and every alias spelling.
--
-- Found 3 Nov 2026 while verifying the pick chip in production: the first card with a player
-- tag sat at position 14. Three causes, all here or in the schedule beside this file:
--   1. The nightly tagger ran at 08:10 UTC; the YouTube pipeline ingests at 09:00. Every day's
--      new Shorts sat untagged at the top of the feed for a day. A second job now runs the
--      tagger every two hours over the last week (cron 'feed_tag_videos_2h', scheduled 3 Nov).
--   2. The tagger only looked at creator_content_type = 'SHORTS'. The feed serves any clip of
--      180 seconds or less; 18 of the 300 served were VIDEO_ON_DEMAND or untyped and never tagged.
--   3. Word boundaries: '\mc\.j\.\M' never matches "C.J. said", because \M needs a word
--      character before it and a dot is not one. Boundaries are now "start or non-alphanumeric"
--      on both sides, so an alias ending in a dot matches too.
-- Nicknames (tier 3: "tank", "c.j.", "cj") keep their lower confidence; this changes reach, not trust.

create or replace function public.feed_tag_videos(since interval default '1 year 2 mons'::interval)
returns table(tagged_videos bigint, labels bigint)
language plpgsql
as $function$
declare
  conf_by_tier constant real[] := array[1.0, 0.8, 0.6];
  lb constant text := '(^|[^[:alnum:]])';
  rb constant text := '([^[:alnum:]]|$)';
begin
  delete from public.feed_video_entities
   where entity_slug in (select public.feed_excluded_slugs());

  insert into public.feed_video_entities (video_id, entity_type, entity_slug, confidence, matched_on)
  select v.id, a.entity_type, a.entity_slug,
         max(case when lower(v.title) ~* (lb || public.feed_rx_escape(a.alias) || rb)
                  then conf_by_tier[a.tier]
                  else conf_by_tier[a.tier] * 0.8 end),
         case when bool_or(lower(v.title) ~* (lb || public.feed_rx_escape(a.alias) || rb))
              then 'title' else 'description' end
  from public.videos v
  join public.feed_entity_aliases a
    on (lower(v.title) ~* (lb || public.feed_rx_escape(a.alias) || rb)
        or (a.tier = 1 and lower(coalesce(v.description, '')) ~* (lb || public.feed_rx_escape(a.alias) || rb)))
  where (v.creator_content_type = 'SHORTS' or v.duration_seconds <= 180)
    and v.is_active is distinct from false
    and v.published_at >= now() - since
    and a.entity_slug not in (select public.feed_excluded_slugs())
  group by v.id, a.entity_type, a.entity_slug
  on conflict (video_id, entity_type, entity_slug) do update
    set confidence = greatest(public.feed_video_entities.confidence, excluded.confidence),
        matched_on = case when excluded.confidence > public.feed_video_entities.confidence
                          then excluded.matched_on else public.feed_video_entities.matched_on end,
        assigned_at = now();

  insert into public.feed_video_entities (video_id, entity_type, entity_slug, confidence, matched_on)
  select distinct on (v.id) v.id, 'opponent',
         lower(regexp_replace(split_part(g.opponent, ' ', array_length(string_to_array(g.opponent,' '),1)), '[^a-z0-9]', '', 'gi')),
         0.7, 'schedule'
  from public.videos v
  join public.texans_games g
    on abs(v.published_at::date - g.game_date) <= 3
  where (v.creator_content_type = 'SHORTS' or v.duration_seconds <= 180)
    and v.is_active is distinct from false
    and v.published_at >= now() - since
    and g.game_type in ('regular', 'postseason', 'preseason')
  order by v.id, abs(v.published_at::date - g.game_date)
  on conflict (video_id, entity_type, entity_slug) do nothing;

  return query
    select count(distinct video_id), count(*) from public.feed_video_entities;
end $function$;

-- The two-hourly pass over the last week, beside the nightly full pass (scheduled 3 Nov 2026):
--   select cron.schedule('feed_tag_videos_2h', '25 */2 * * *', $$select public.feed_tag_videos(interval '7 days')$$);
