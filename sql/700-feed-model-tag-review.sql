-- 700: the tag review studio (workstream 7). Juan accepts or rejects a model tag in one tap.
--
-- Every ask the feed makes rests on a tag: no player on a clip, no pick chip, nothing learned.
-- The model pass (sql/100, workers/feed/src/tagger.js) writes its labels at 0.7, matched_on =
-- 'model'. Here a person settles each one:
--   accept: confidence 1.0, matched_on 'reviewed'. The catalogue orders a card's players by
--           confidence, so the reviewed player leads the card and its chip. The alias tagger's
--           upsert keeps the greater confidence and its matched_on, so a reviewed row survives
--           every re-tag.
--   reject: the label is deleted and appended to feed_model_tag_runs.rejected with reviewed_by
--           and reviewed_at, beside the dictionary refusals the pass already records there (those
--           carry no reviewed_at). The run row stays, so the pass never asks about the clip again.
-- Accepts are appended to the new feed_model_tag_runs.accepted the same way, so the accept rate
-- is a count of two lists and the labels the model wrote stay as they were written.
--
-- All three functions are service key only: the Worker calls them behind the upload key.

alter table public.feed_model_tag_runs
  add column if not exists accepted jsonb not null default '[]'::jsonb;  -- [{type, slug, confidence, reviewed_by, reviewed_at}]

-- The queue: the newest model labels still unreviewed, with what Juan needs to judge them.
create or replace function public.feed_model_tag_queue(lim integer default 50)
returns jsonb
language sql
stable
as $$
  with pending as (
    select e.video_id, e.entity_type, e.entity_slug, e.confidence, r.asked_at,
           v.title, left(coalesce(v.description, ''), 280) as description, v.thumbnail_url, v.published_at,
           (select a.alias from public.feed_entity_aliases a
             where a.entity_type = e.entity_type and a.entity_slug = e.entity_slug
             order by a.tier, length(a.alias) desc limit 1) as name
    from public.feed_video_entities e
    join public.feed_model_tag_runs r on r.video_id = e.video_id
    join public.videos v on v.id = e.video_id
    where e.matched_on = 'model'
  )
  select jsonb_build_object(
    'pending', (select count(*) from pending),
    'items', coalesce((select jsonb_agg(to_jsonb(p) order by p.asked_at desc, p.video_id, p.entity_slug)
                         from (select * from pending order by asked_at desc, video_id, entity_slug limit greatest(1, least(lim, 200))) p), '[]'::jsonb)
  );
$$;
revoke execute on function public.feed_model_tag_queue(integer) from public, anon, authenticated;

-- One verdict, atomically. Only a label still at matched_on = 'model' can be reviewed, so a
-- double tap or a second reviewer gets ok = false instead of a second record.
create or replace function public.feed_model_tag_review(vid text, etype text, eslug text, verdict text, reviewer text)
returns jsonb
language plpgsql
as $$
declare
  conf real;
  rec jsonb;
begin
  if verdict not in ('accept', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'verdict is accept or reject');
  end if;
  if coalesce(btrim(reviewer), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'reviewer required');
  end if;

  -- The confidence the model wrote, read under a row lock so two taps cannot both pass.
  select e.confidence into conf from public.feed_video_entities e
   where e.video_id = vid and e.entity_type = etype and e.entity_slug = eslug and e.matched_on = 'model'
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no unreviewed model tag for that clip and label');
  end if;

  if verdict = 'accept' then
    update public.feed_video_entities
       set confidence = 1.0, matched_on = 'reviewed', assigned_at = now()
     where video_id = vid and entity_type = etype and entity_slug = eslug;
  else
    delete from public.feed_video_entities
     where video_id = vid and entity_type = etype and entity_slug = eslug;
  end if;

  rec := jsonb_build_object('type', etype, 'slug', eslug, 'confidence', conf,
                            'reviewed_by', left(btrim(reviewer), 40), 'reviewed_at', now());
  if verdict = 'accept' then
    update public.feed_model_tag_runs set accepted = accepted || jsonb_build_array(rec) where video_id = vid;
  else
    update public.feed_model_tag_runs set rejected = rejected || jsonb_build_array(rec) where video_id = vid;
  end if;
  return jsonb_build_object('ok', true, 'verdict', verdict, 'video_id', vid, 'type', etype, 'slug', eslug, 'record', rec);
end $$;
revoke execute on function public.feed_model_tag_review(text, text, text, text, text) from public, anon, authenticated;

-- For the daily review: the accept rate over the last day and over all time, what is still
-- waiting, and the label rejected most (the first candidate for a prompt example).
create or replace function public.feed_model_tag_review_report()
returns table(reviewed_24h bigint, accepted_24h bigint, rejected_24h bigint, accept_rate_24h numeric,
              reviewed bigint, accepted bigint, rejected bigint, accept_rate numeric,
              pending bigint, reviewers bigint, most_rejected text, last_reviewed_at timestamptz)
language sql
stable
as $$
  with v as (
    select 'accept' as verdict, a from public.feed_model_tag_runs r, jsonb_array_elements(r.accepted) a
    union all
    select 'reject', x from public.feed_model_tag_runs r, jsonb_array_elements(r.rejected) x
     where x ? 'reviewed_at'
  ), t as (
    select verdict, a->>'type' || '/' || (a->>'slug') as label, a->>'reviewed_by' as who, (a->>'reviewed_at')::timestamptz as at from v
  )
  select count(*) filter (where at > now() - interval '1 day'),
         count(*) filter (where verdict = 'accept' and at > now() - interval '1 day'),
         count(*) filter (where verdict = 'reject' and at > now() - interval '1 day'),
         round(count(*) filter (where verdict = 'accept' and at > now() - interval '1 day')::numeric
               / nullif(count(*) filter (where at > now() - interval '1 day'), 0), 3),
         count(*),
         count(*) filter (where verdict = 'accept'),
         count(*) filter (where verdict = 'reject'),
         round(count(*) filter (where verdict = 'accept')::numeric / nullif(count(*), 0), 3),
         (select count(*) from public.feed_video_entities e where e.matched_on = 'model'),
         count(distinct who),
         (select label from t where verdict = 'reject' group by label order by count(*) desc, label limit 1),
         max(at)
  from t;
$$;
revoke execute on function public.feed_model_tag_review_report() from public, anon, authenticated;
