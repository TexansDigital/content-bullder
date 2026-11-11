-- 410: live site weights at feed time (workstream 3 follow-up, 11 Nov 2026).
--
-- The 10 Nov review found that most fans who read the site and then open the feed do both in
-- the same visit, minutes apart. feed_rollup_site() runs every two hours, so at feed time those
-- fans still carry no site_weights and site_rank cannot fire for them: on 9 Nov every roster
-- feed session in the site arm whose profile later gained a site player was ranked shared.
-- This function scores one fan's own page views on demand, with the same scoring as the rollup
-- (page tags through feed_site_page_entities, confidence times a 30-day half-life, normalised
-- to the strongest key). The Worker calls it only when site_rank is on, the fan has no explicit
-- picks, the feed has not watched them enough to rank, and the profile has no site_weights yet.
-- Service key only; the publishable key cannot call it.

create or replace function public.feed_site_weights_live(sid text, lookback interval default '7 days'::interval, lim integer default 40)
returns jsonb
language sql
stable
as $$
  with v as (
    select s.page_tags, s.page_title, s.at
    from public.feed_site_views s
    where s.session_id = sid and s.at >= now() - lookback
    order by s.at desc
    limit lim
  ),
  scored as (
    select pe.entity_type || ':' || pe.entity_slug as key,
           sum(pe.confidence * power(0.5, extract(epoch from (now() - v.at)) / (30 * 86400))) as score
    from v cross join lateral public.feed_site_page_entities(v.page_tags, v.page_title) pe
    group by 1
  )
  select coalesce(
    (select jsonb_object_agg(key, round((score / mx)::numeric, 3))
       from (select key, score, max(score) over () as mx from scored where score > 0) z),
    '{}'::jsonb);
$$;
revoke execute on function public.feed_site_weights_live(text, interval, integer) from anon, authenticated;
comment on function public.feed_site_weights_live(text, interval, integer) is
  'One fan''s site entity weights from their own recent page views, scored like feed_rollup_site, for the feed to rank on before the rollup has run.';
