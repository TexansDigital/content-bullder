# Supabase SQL for the fan-signal layer

Project: `texans-youtube-dashboard` (`xisvulbabqsyxnlyuwcz`). Run in order in the SQL editor.

| File | What it does | Status |
|---|---|---|
| `010-feed-fan-signal-tables.sql` | Creates `feed_entity_aliases`, `feed_video_entities`, `feed_events`, `feed_profiles`, RLS, and the `excluded_players` trigger | applied 31 Oct 2026 |
| `020-aliases-roster.sql` | 166 roster aliases, tiers 1 and 2 | applied 31 Oct 2026 |
| `030-aliases-former.sql` | former players, coach, GM. Full-name only | applied 31 Oct 2026 |
| `040-feed-items.sql` | `feed_items`: studio-published cards mirrored for the public Worker. Anon reads published rows only | **not yet applied** (connector prompt timed out) |

Already applied as functions: `feed_rx_escape`, `feed_tag_videos(since)` (honours `excluded_players`),
`feed_rollup_profiles(lookback)`, `feed_prune_events()`.

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
