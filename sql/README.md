# Supabase SQL for the fan-signal layer

Project: `texans-youtube-dashboard` (`xisvulbabqsyxnlyuwcz`). Run in order in the SQL editor.

| File | What it does | Status |
|---|---|---|
| `010-feed-fan-signal-tables.sql` | Creates `feed_entity_aliases`, `feed_video_entities`, `feed_events`, `feed_profiles`, RLS, and the `excluded_players` trigger | applied 31 Oct 2026 |
| `020-aliases-roster.sql` | 166 roster aliases, tiers 1 and 2 | applied 31 Oct 2026 |
| `030-aliases-former.sql` | former players, coach, GM. Full-name only | applied 31 Oct 2026 |
| `040-feed-items.sql` | `feed_items`: studio-published cards mirrored for the public Worker. Anon reads published rows only | applied 31 Oct 2026 |
| `080-feed-watch-stadium.sql` | the first `watch` answer is stored as `stadium`; the Colts offer blurb names Reliant Stadium | applied 2 Nov 2026 |
| `070-feed-preferences-questions.sql` | `going` and `watch` on `feed_preferences`; `feed_week(sid)` for the weekly card (service role only) | applied 1 Nov 2026 |
| `060-feed-preferences-experiments.sql` | `feed_preferences` (what a fan picked, service key only), `feed_presets` (TORO's picks seeded), `feed_boost_offers` (time-boxed "more of X until date" offers), `feed_experiments` (knob arms assigned per visitor by hash). Public rows are only the active/running config | applied 1 Nov 2026 |
| `050-feed-rollup-counts.sql` | `feed_rollup_profiles` counts card events only and recomputes the count each run instead of adding to it (the first scheduled run had doubled every profile) | applied 1 Nov 2026 |

Already applied as functions: `feed_rx_escape`, `feed_tag_videos(since)` (honours `excluded_players`),
`feed_rollup_profiles(lookback)` (current body in `050`), `feed_prune_events()`.
The Worker ranks a session only once its profile holds six or more card events (`MIN_EVENTS` in `src/rank.js`).

First tagging pass ran 31 Oct 2026 over 36 months: 1,871 of 2,401 Shorts tagged, 2,474 labels
(1,007 player, 1,467 opponent from the schedule). Nightly pg_cron jobs at 08:10, 08:25 and
08:40 UTC re-tag the last 14 months, roll up profiles, and prune events older than 90 days.
To re-run by hand:

```sql
select * from public.feed_tag_videos();
```

Exclusion is enforced twice. The trigger stops an excluded name entering the dictionary.
`feed_tag_videos` purges labels for any name added to `excluded_players` later and never
writes new ones. To exclude someone, add a row to `excluded_players`. Nothing else to do.

## The preference layer

`feed_preferences` is written only by the Worker (`POST /api/prefs`) with the service key and
read back on every `/api/feed?sid=`. Explicit picks outrank history: a picked player scores 2.0
against a card, a live boost 2.5, a lane 0.8 (constants in `src/rank.js`). Every card an
explicit signal moves carries a `why` the page shows as a pill.

To offer a time-boxed boost ("Draft news until 24 Apr"), insert a row:

```sql
insert into public.feed_boost_offers (key, label, blurb, content_types, keywords, ends_at, created_by)
values ('draft-2027', 'Draft news', 'Mocks, visits, picks', '{draft_roster}', '{draft,mock,prospect}', '2027-04-24 23:59-05', 'adam');
```

To run an experiment, insert a row with `status = 'running'`. Arms are `{arm: weight}`; knobs
are `{arm: {knob: value}}` and only knobs named in `KNOB_DEFAULTS` (`src/rank.js`) take effect:
`picker_position`, `picker_reoffer_days`, `reason_pills` (explicit | all | off), `sound_hint`,
`capture_card` (`{position, headline, blurb, cta, form, campaign}`).

```sql
insert into public.feed_experiments (key, hypothesis, metric, arms, knobs, traffic, status, created_by)
values ('picker_pos', 'Offering the picker on card 1 raises saves without hurting depth', 'prefs_save / feed_load',
        '{"control": 1, "first": 1}', '{"first": {"picker_position": 0}}', 0.5, 'running', 'engagement-review');
```

Every `feed_load` event carries `exp_<key>: <arm>` so results can be sliced by arm.
| 090-feed-tagger-reach.sql | Applied 3 Nov 2026 | The tagger reaches every clip the feed serves (not only typed Shorts), aliases ending in a dot match, and a two-hourly pass covers the last week so new Shorts are tagged within two hours of ingest instead of a day. |
| 100-feed-model-tags.sql | Applied 4 Nov 2026 | `feed_model_tag_runs` (service key only: every clip the model pass asked, its labels and cost), `feed_model_tag_candidates(lim, months, served)` (the served Shorts with no player, coach, staff or theme and no run row, plus the last day's spend) and `feed_model_tag_report()` for the review. The pass itself runs in the Worker cron (`workers/feed/src/tagger.js`). |
| 700-feed-model-tag-review.sql | Applied 4 Nov 2026 | The tag review studio at `/studio/tags` (`workers/feed/src/tags.js`, `app/tags.html`): `feed_model_tag_runs.accepted`, `feed_model_tag_queue(lim)` (the newest unreviewed model tags with title and poster), `feed_model_tag_review(vid, etype, eslug, verdict, reviewer)` (accept: 1.0 and `matched_on = 'reviewed'`; reject: deleted and appended to `rejected` with `reviewed_by` and `reviewed_at`) and `feed_model_tag_review_report()` for the daily review's accept rate. Service key only. |
| 400-site-signals.sql | Applied 4 Nov 2026 | Site signals (workstream 3). `feed_profiles.site_weights/site_sections/site_views/site_last_seen`, `feed_site_views` (fan page_view rows only), `feed_site_page_entities(tags, title)`, `feed_rollup_site(lookback)` every two hours at :20 (nightly at 08:20 UTC until 9 Nov 2026), `feed_site_report(days)`. See docs/site-signals.md. |
