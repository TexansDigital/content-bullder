-- 100: the model tagging pass. Approved by Adam 4 Nov 2026 ("do the small spend").
--
-- Two thirds of the served Shorts name no player in a way the alias tagger can see ("QB1 👆",
-- "Tank had the perfect answer" in the description, "Imi is going to hold it down"). A clip with
-- no player and no theme earns no pick chip, so the fan is never asked. The Worker's cron
-- (workers/feed/src/tagger.js, every two hours at :45, after the alias pass at :25) sends the
-- title and description of the untagged clips to Claude with the alias dictionary and writes
-- what comes back into feed_video_entities as matched_on = 'model', confidence capped at 0.7,
-- so a title match by the alias tagger (1.0 / 0.8) always outranks it. Existing rows are never
-- overwritten. Every clip asked gets one row here, found or not, so it is never asked twice and
-- the spend is visible to the review.

create table if not exists public.feed_model_tag_runs (
  video_id          text        primary key,
  model             text        not null,
  asked_at          timestamptz not null default now(),
  input_tokens      integer     not null default 0,
  cache_read_tokens integer     not null default 0,
  cache_write_tokens integer    not null default 0,
  output_tokens     integer     not null default 0,
  cost_usd          numeric(9,6) not null default 0,
  labels            jsonb       not null default '[]'::jsonb,   -- what was written: [{type, slug, confidence}]
  rejected          jsonb       not null default '[]'::jsonb    -- what the model proposed and the dictionary refused
);
create index if not exists feed_model_tag_runs_asked_idx on public.feed_model_tag_runs (asked_at desc);
alter table public.feed_model_tag_runs enable row level security;
-- No anon policy: only the service key (the Worker) reads or writes this table.

-- The clips to ask about: among the Shorts the feed serves (same filter and window as the
-- catalogue), those with no player, coach, staff or theme label and no run row yet, newest
-- first since those sit at the top of the feed. Also what the pass has spent in the last day,
-- so the Worker can stop at its cap before asking.
create or replace function public.feed_model_tag_candidates(lim integer default 40, months integer default 12, served integer default 300)
returns jsonb
language sql
stable
as $$
  with window_ as (
    select v.id, v.title, v.description
    from public.videos v
    where (v.creator_content_type = 'SHORTS' or v.duration_seconds <= 180)
      and v.is_active is distinct from false
      and v.published_at >= now() - make_interval(months => months)
    order by v.published_at desc
    limit served
  ),
  untagged as (
    select w.*
    from window_ w
    where not exists (select 1 from public.feed_video_entities e
                       where e.video_id = w.id and e.entity_type in ('player', 'coach', 'staff', 'theme'))
      and not exists (select 1 from public.feed_model_tag_runs r where r.video_id = w.id)
    limit lim
  )
  select jsonb_build_object(
    'spent_24h', coalesce((select sum(cost_usd) from public.feed_model_tag_runs where asked_at > now() - interval '1 day'), 0),
    'untagged_total', (select count(*) from window_ w
                        where not exists (select 1 from public.feed_video_entities e
                                           where e.video_id = w.id and e.entity_type in ('player', 'coach', 'staff', 'theme'))),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'description', description)) from untagged), '[]'::jsonb)
  );
$$;
revoke execute on function public.feed_model_tag_candidates(integer, integer, integer) from anon, authenticated;

-- For the daily review: what the pass has asked, found and spent.
create or replace function public.feed_model_tag_report()
returns table(asked bigint, found bigint, labels bigint, rejected bigint, cost_usd numeric, cost_24h numeric, last_asked timestamptz)
language sql
stable
as $$
  select count(*),
         count(*) filter (where jsonb_array_length(r.labels) > 0),
         coalesce(sum(jsonb_array_length(r.labels)), 0),
         coalesce(sum(jsonb_array_length(r.rejected)), 0),
         coalesce(sum(r.cost_usd), 0),
         coalesce(sum(r.cost_usd) filter (where r.asked_at > now() - interval '1 day'), 0),
         max(r.asked_at)
  from public.feed_model_tag_runs r;
$$;
revoke execute on function public.feed_model_tag_report() from anon, authenticated;
