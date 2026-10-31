# Supabase SQL for the fan-signal layer

Project: `texans-youtube-dashboard` (`xisvulbabqsyxnlyuwcz`). Run in order in the SQL editor.

| File | What it does | Status |
|---|---|---|
| `010-feed-fan-signal-tables.sql` | Creates `feed_entity_aliases`, `feed_video_entities`, `feed_events`, `feed_profiles`, RLS, and the `excluded_players` trigger | **not yet applied** (connector prompt timed out twice) |
| `020-aliases-roster.sql` | 166 roster aliases, tiers 1 and 2 | waiting on 010 |
| `030-aliases-former.sql` | former players, coach, GM. Full-name only | needs Adam's approval, then waiting on 010 |

Already applied as functions: `feed_rx_escape`, `feed_tag_videos(since)` (honours `excluded_players`),
`feed_rollup_profiles(lookback)`, `feed_prune_events()`.

After 010 and 020, the first tagging pass is:

```sql
select * from public.feed_tag_videos();
```

Exclusion is enforced twice. The trigger stops an excluded name entering the dictionary.
`feed_tag_videos` purges labels for any name added to `excluded_players` later and never
writes new ones. To exclude someone, add a row to `excluded_players`. Nothing else to do.
