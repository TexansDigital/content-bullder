# 16 — What already exists

Read directly from production on 30 October 2026, after the objectives were restated as
(a) understand fans better than any other team, (b) capitalize on social-sized content on
the website, (c) identify fans and move them down the purchase funnel.

The finding: most of the fan-signal stack exists already, across one Supabase project and
three Cloudflare D1 databases. It is not connected. Several things this project was about
to build are listed below as "exists — use it".

## Supabase `texans-youtube-dashboard` (`xisvulbabqsyxnlyuwcz`)

Not a dashboard. A content intelligence platform.

| Table | Rows | What it gives us |
| --- | --- | --- |
| `videos` | 7,012 | The catalogue. 1,100 Shorts in the last 12 months, 948 under 60s, 481 over 10k views |
| `short_content_types` | 923 | **18 real content types** for Shorts — `game_action`, `fun_trends`, `hype_brand`, `player_stories`, `pranks`, `opponent_week`… Covers 688 of the 1,100 recent Shorts. `source` includes `claude`, so a labelling path exists |
| `short_labels` | 684 | `evergreen` / `timely`. 472 of recent Shorts |
| `content_taxonomy` + `video_taxonomy` | 39 / 5,081 | Content types and series by regex. Tags most Shorts as `short_form` — format, not content |
| `transcripts` | 1,493 | `diarized_json` is **segment-level** (`{start,end,text}` per phrase). Captions yes; word cuts no |
| `scored_clips` / `clip_jobs` / `clippabull_*` | 2,073 / 1,556 / 12k | An automated clipping pipeline with hook, star-power and shareability scores |
| `texans_games` | 65 | Opponent, kickoff, result — the opponent axis for tagging by publish date |
| `excluded_players` | 3 | A denylist that already exists |

**`videos.tags` is useless for entities.** 2,060 of ~2,780 Shorts carry the same fifteen
boilerplate tags (Nick Caserio, Cal McNair, NRG Park, Touchdown). Entities must come from
titles and transcripts.

## D1 `ht-attribution` (`99dd013c-…`)

Ticket attribution. **Conversions are here.**

| Table | Rows | Note |
| --- | --- | --- |
| `purchases` | 11,232 | TM `event_id`, `order_total`, `transaction_id`, `num_tickets`. 17 Jul → today |
| `attributions` | 969 | Click → purchase with `match_type` and confidence. 118 strong |
| `order_matches` | 1,805 | Transaction → landing code. `person_hash` **null on all rows** |
| `site_sessions` | 9,628 | `session_id` is **pocketID** — every row is `sess_*`. Since **18 Oct only**. `person_hash` **null on all rows**; `eloqua_guid` on 3,336 |
| `clicks` | 11,956 | `eloqua_guid`, `ga_cid`, `nfl_device_id`, IP/UA hashes. **No session or pocket column** |
| `person_devices` | 15 | Effectively unused |

**The broken join.** A pocket session reaches a purchase today only via `eloqua_guid`
(35% of sessions) or IP+UA fingerprint. Adding `session_id` to `clicks`, read from the same
localStorage key the `session-attribution` block uses, makes pocket → click → purchase a
direct join. One column.

## D1 `pocket-registry` (`5ece8636-…`)

| Table | Rows | Note |
| --- | --- | --- |
| `players` | 95 | Roster players with alias lists: `c j stroud\|c.j. stroud\|cj\|c.j.\|stroud`. **The entity dictionary, already written** |
| `articles` | — | Site news indexed with tags and `tag_labels` |
| `recommend_clicks` | — | A recommendation widget already measures clicks by position |

## D1 `fan-identity-stitching` (`95e512c2-…`)

`identity_pairs(email, ga4_client_id)` and `stitching_events` with `event_source` of
`form_fill | email_click | pocket_login | app_login`. **Zero rows.** Stage three of the
identity ladder, designed and never populated.

## What this changes

| Was going to build | Exists — use it |
| --- | --- |
| Entity tagging from scratch | `pocket-registry.players` aliases over title + transcript |
| Content classification for Shorts | `short_content_types`; backfill the 38% gap on the existing path |
| A profile / preference store | `site_sessions` keyed on pocketID; affinity is a sibling table |
| Funnel instrumentation | `ht-attribution` purchases + attributions; add one column |
| Email ↔ identity resolution schema | `fan-identity-stitching`, waiting for rows |
| Transcription | `transcripts`, segment-level — adequate for captions |

**Parked:** presser clipping, Cloudinary as a third destination, word-level transcription.
Real work; none of it serves (a), (b) or (c).

## Open

1. Who owns the click-tracker Worker — for the `session_id` column.
2. Why `person_hash` is null everywhere: not wired, or abandoned.
3. Whether `fan-identity-stitching` is paused or dropped.
