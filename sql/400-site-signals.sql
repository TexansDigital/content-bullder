-- Site signals, workstream 3. Handshake v5 sends one page_view per article, gallery, video or
-- podcast page on houstontexans.com, with the page's own JSON-LD keywords and section, only
-- with Performance consent (C0002) and a pocket id. This file turns those rows into taste.
--
-- What it adds, nothing existing changed:
--   feed_profiles.site_*      what the fan read on the site, beside (not inside) the feed's
--                             own weights, so feed_rollup_profiles can never overwrite it and
--                             the review can tell the site's signal from the feed's.
--   feed_site_views           fan page views only: qa, automated, Adam's session and test ids out.
--   feed_site_page_entities   a page's tags and title -> dictionary slugs (excluded names never).
--   feed_rollup_site(lookback)  rebuild of the site_* columns every two hours at :20 (nightly only until 9 Nov 2026).
--   feed_site_report(days)    the numbers for the review.
-- Idempotent. Project xisvulbabqsyxnlyuwcz.

alter table public.feed_profiles
  add column if not exists site_weights  jsonb       not null default '{}'::jsonb,
  add column if not exists site_sections jsonb       not null default '{}'::jsonb,
  add column if not exists site_views    integer     not null default 0,
  add column if not exists site_last_seen timestamptz;

comment on column public.feed_profiles.site_weights is
  'entity_type:slug -> 0..1 from page_view on houstontexans.com (handshake v5). Written only by feed_rollup_site.';

-- Fan page views. Every exclusion the reviews use, in one place.
create or replace view public.feed_site_views
with (security_invoker = true) as
select e.id, e.session_id, e.at,
       e.params->>'page_type'    as page_type,
       e.params->>'page_path'    as page_path,
       nullif(e.params->>'page_section', '') as page_section,
       e.params->>'page_title'   as page_title,
       coalesce(e.params->'page_tags', '[]'::jsonb) as page_tags
from public.feed_events e
where e.event = 'page_view'
  and e.session_id is not null
  and coalesce(e.params->>'qa', '') <> 'true'
  and coalesce(e.params->>'automated', '') <> 'true'
  and e.session_id <> 'sess_1786805317298_00hak59zn'
  and e.session_id !~* '(smoketest|armcheck|test)'
  and coalesce(e.device_id, '') !~* '(smoketest|armcheck|test)';

revoke all on public.feed_site_views from anon, authenticated;

-- A page's tags and title to dictionary entities. A keyword that is exactly an alias of tier 1
-- or 2 counts at that tier's confidence (the site's editors tagged it); a full name (tier 1)
-- inside the title counts at 0.8, which is how video pages, which carry no keywords, are read.
-- Editorial tags ("Homepage CP", "vanderblog", game ids) match nothing. Opponents are left out:
-- a game recap tags the opponent, and that is not the fan's taste.
create or replace function public.feed_site_page_entities(tags jsonb, title text)
returns table (entity_type text, entity_slug text, confidence real)
language sql stable as $$
  with kw as (
    select distinct lower(trim(t)) as k
    from jsonb_array_elements_text(case when jsonb_typeof(tags) = 'array' then tags else '[]'::jsonb end) t
  ),
  hits as (
    select a.entity_type, a.entity_slug, (array[1.0, 0.8, 0.6]::real[])[a.tier] as c
    from kw join public.feed_entity_aliases a on a.alias = kw.k and a.tier <= 2
    union all
    select a.entity_type, a.entity_slug, 0.8::real
    from public.feed_entity_aliases a
    where a.tier = 1 and coalesce(title, '') <> ''
      and lower(title) ~* ('(^|[^[:alnum:]])' || public.feed_rx_escape(a.alias) || '([^[:alnum:]]|$)')
  )
  select h.entity_type, h.entity_slug, max(h.c)::real
  from hits h
  where h.entity_type in ('player', 'coach', 'staff', 'theme')
    and h.entity_slug not in (select public.feed_excluded_slugs())
  group by 1, 2;
$$;

-- Rebuilds site_* for every pocket id with a fan page view inside lookback, from all of that
-- fan's page views still held (90 days, the same prune as every feed event). Each view is worth
-- 1.0 x confidence, halved every 30 days, normalised so the fan's top entity is 1, like
-- entity_weights. Only the site_* columns are written; a fan with no feed profile yet gets a row
-- with events = 0, which the ranker already treats as "not enough to rank on".
create or replace function public.feed_rollup_site(lookback interval default '2 days'::interval)
returns integer
language plpgsql
as $function$
declare
  touched integer;
begin
  with recent as (
    select distinct session_id as who from public.feed_site_views where at >= now() - lookback
  ),
  v as (
    select s.* from public.feed_site_views s join recent r on r.who = s.session_id
  ),
  scored as (
    select v.session_id as who, pe.entity_type || ':' || pe.entity_slug as key,
           sum(pe.confidence * power(0.5, extract(epoch from (now() - v.at)) / (30 * 86400))) as score
    from v cross join lateral public.feed_site_page_entities(v.page_tags, v.page_title) pe
    group by 1, 2
  ),
  sec as (
    select v.session_id as who, lower(v.page_section) as key,
           sum(power(0.5, extract(epoch from (now() - v.at)) / (30 * 86400))) as score
    from v where v.page_section is not null
    group by 1, 2
  ),
  sw as (
    select who, jsonb_object_agg(key, round((score / mx)::numeric, 3)) as weights
    from (select who, key, score, max(score) over (partition by who) as mx from scored where score > 0) z
    group by who
  ),
  cw as (
    select who, jsonb_object_agg(key, round((score / mx)::numeric, 3)) as weights
    from (select who, key, score, max(score) over (partition by who) as mx from sec where score > 0) z
    group by who
  ),
  stats as (
    select session_id as who, count(*) as n, min(at) as first_at, max(at) as last_at from v group by 1
  )
  insert into public.feed_profiles (session_id, site_weights, site_sections, site_views, site_last_seen,
                                    first_seen, last_seen, updated_at)
  select s.who, coalesce(sw.weights, '{}'::jsonb), coalesce(cw.weights, '{}'::jsonb), s.n, s.last_at,
         s.first_at, s.last_at, now()
  from stats s left join sw on sw.who = s.who left join cw on cw.who = s.who
  on conflict (session_id) do update
    set site_weights   = excluded.site_weights,
        site_sections  = excluded.site_sections,
        site_views     = excluded.site_views,
        site_last_seen = excluded.site_last_seen,
        first_seen     = least(public.feed_profiles.first_seen, excluded.first_seen),
        last_seen      = greatest(public.feed_profiles.last_seen, excluded.last_seen),
        updated_at     = now();
  get diagnostics touched = row_count;
  return touched;
end $function$;

comment on function public.feed_rollup_site(interval) is
  'Rebuilds feed_profiles.site_* from fan page_view events (handshake v5) for pocket ids seen within lookback.';

-- The review's numbers. One row per metric, plain counts. Fan traffic only.
create or replace function public.feed_site_report(days integer default 1)
returns table (metric text, value numeric, detail text)
language sql stable as $$
  with v as (select * from public.feed_site_views where at >= now() - make_interval(days => days)),
  ents as (
    select v.id, v.session_id, pe.entity_type, pe.entity_slug
    from v cross join lateral public.feed_site_page_entities(v.page_tags, v.page_title) pe
  ),
  feed_fans as (
    select distinct session_id from public.feed_events
    where event = 'feed_load' and session_id is not null
      and coalesce(params->>'qa', '') <> 'true' and coalesce(params->>'automated', '') <> 'true'
  ),
  guid_fans as (
    select distinct session_id from public.feed_events
    where event = 'identity' and session_id is not null and coalesce(params->>'eloqua_guid', params->>'guid', '') <> ''
  )
  select 'page_views', count(*)::numeric, null from v
  union all select 'fans (pocket ids)', count(distinct session_id)::numeric, null from v
  union all select 'page_views naming a player', count(distinct id)::numeric, null from ents where entity_type = 'player'
  union all select 'fans with a site player', count(distinct session_id)::numeric, null from ents where entity_type = 'player'
  union all select 'site fans who also opened the feed (ever)', count(distinct v.session_id)::numeric, null
            from v join feed_fans f on f.session_id = v.session_id
  union all select 'site fans already recognised by Eloqua GUID', count(distinct v.session_id)::numeric, null
            from v join guid_fans g on g.session_id = v.session_id
  union all select 'by page_type', count(*)::numeric, page_type from v group by page_type
  union all (select 'top player', count(distinct session_id)::numeric, entity_slug from ents
             where entity_type = 'player' group by entity_slug order by 2 desc limit 10)
  union all (select 'top section', count(*)::numeric, lower(page_section) from v
             where page_section is not null group by 3 order by 2 desc limit 10);
$$;

revoke execute on function public.feed_rollup_site(interval)  from anon, authenticated;
revoke execute on function public.feed_site_report(integer)   from anon, authenticated;

-- Every two hours at :20 since 9 Nov 2026 (changed on the live job with cron.alter_job). With one run
-- a day at 08:20 UTC, a fan who read the site and opened the feed the same day carried no
-- site_weights yet, so site_rank could never fire for them: 4 of 4 eligible sessions on 8 Nov.
-- The lookback is two days, so each run touches only recent readers. The job name is kept so
-- the review's job table reads on. The nightly 08:20 run still falls between the tagger (08:10)
-- and the feed's profile rollup (08:25); they write different columns.
select cron.unschedule('feed_rollup_site_nightly') where exists (select 1 from cron.job where jobname = 'feed_rollup_site_nightly');
select cron.schedule('feed_rollup_site_nightly', '20 */2 * * *', $$select public.feed_rollup_site()$$);
