# The fan record (workstream 1)

Written 4 Nov 2026 on branch `claude/fan-record`. One row per recognised fan, holding only what
we learned about them. No name, no email, ever.

## Against the objective

| Test | How the fan record meets it |
|---|---|
| Teaches us something about a fan we could not know before | For the first time, one GUID carries what the fan watched in the feed, what they read, where they came in, and the ticket clicks and purchases the pixels saw. Before this, those three facts lived under three ids in two databases. |
| Makes the fan feel the feed listened | `fan_record(guid)` is the one call the Worker can make to open a recognised fan's feed on what they finish, not only on what they saved. Today `/api/who` reads picks or one profile; the record has the whole history. |
| Moves them toward identity or a ticket | `going`, the clicked games and the purchase flags sit next to the player they finish, so a ticket card can name the fan's own player and the game they already looked at. |

## What is built

| Piece | What it does | Status |
|---|---|---|
| `sql/200-fan-records.sql` | `fan_records`, two staging tables, `fan_rollup_records()` nightly at 08:50 UTC, `fan_record(key)`, `fan_records_masked(n)`, `fan_records_report()`. All service-role only. | Written. **Not applied**: production DDL from this session needs Adam's go. |
| `workers/fan-record` | At 08:45 UTC reads the record's GUIDs and pocket ids, copies their D1 ticket clicks and attributed purchases into `fan_ticket_signals`, and asks Eloqua (read only, 50 a night) which GUIDs are contacts. | Written, tested with mocks, bundles. Deploys from `main` only. |
| `test/verify-fan-record.mjs` | 14 checks: folding, firm against weak purchases, our own GUIDs dropped, nothing personal crosses, dry run writes nothing. | Passing |

**Keys.** A fan is `guid:<32 hex>` when any of their sessions carried an Eloqua GUID, else
`pocket:<pocket id>`. A pocket record folds into the GUID record the night the GUID appears.

**Never fan data.** Events with `qa` or `automated`, Adam's session `sess_1786805317298_00hak59zn`,
ids containing smoketest, armcheck or test, every GUID ever seen on one of those, and any session
sending more than one card event a second.

**Retention.** A record not seen for 90 days is deleted, GUID and all, matching the feed's prune.

## First ten records, 4 Nov 2026

Computed read-only with the rollup's own logic, because the migration is not applied yet. Ids are
masked. Ticket columns come from D1 for the three GUIDs that have clicks there.

| Fan | Days | Card events | Finished | Reads | Came in from | Top player | Top content | Ticket clicks | Purchases |
|---|---|---|---|---|---|---|---|---|---|
| guid 8e83…5066 | 1 | 22 | 6 | 2 | home | Will Anderson Jr | game action | 2: Giants, Colts | 1 weak, $350 |
| guid 2d13…74e3 | 1 | 22 | 8 | 3 | roster | Tank Dell | fun & trends | 0 | 0 |
| guid 6e5a…18b3 | 1 | 15 | 4 | 2 | roster | Tank Dell | fun & trends | 0 | 0 |
| guid 7147…e9d7 | 1 | 4 | 2 | 1 | roster ×3 | Tank Dell | fun & trends | 0 | 0 |
| guid 9682…4fb2 | 1 | 2 | 0 | 0 | roster | Tank Dell | coaches | 0 | 0 |
| guid 30ea…0574 | 1 | 12 | 2 | 1 | roster ×2 | none | fun & trends | 0 | 0 |
| guid 242c…6ca0 | 2 | 11 | 5 | 5 | news ×5, roster ×9 | none | fun & trends | 3: Giants | 1 weak, $560 |
| guid 74f1…6f17 | 1 | 9 | 19 | 19 | roster ×21 | none | fun & trends | 0 | 0 |
| guid 6c6f…310b | 3 | 8 | 0 | 0 | news ×10 | none | none | 0 | 0 |
| guid 9ffa…b781 | 1 | 8 | 0 | 0 | roster ×5 | none | fun & trends | 0 | 0 |

## What the data showed

| Count | Value |
|---|---|
| Records | 443 |
| Keyed by GUID | 187 |
| Pocket only | 256 |
| With a saved pick from a real fan | 0 |
| With a going or watch answer | 0 |
| With a top player | 21, of which 5 are GUID records |
| Seen on more than one day | 17 |
| Seen on more than one pocket id | 0 |
| Feed GUIDs with any D1 ticket click | 3 |
| Feed sessions whose id appears in D1 clicks | 0 |
| Purchases reaching a fan, firm | 0 |
| Purchases reaching a fan, weak (same ip and user agent that day) | 2 |

1. **Every saved pick is ours.** All 7 rows in `feed_preferences` sit on sessions with no clean
   event: Adam's, QA sessions, and welcome copies of a QA pick. No real fan has saved a pick or answered a question yet.
2. **The profiles miss most of what fans finish.** `feed_profiles` named a player for 1 recognised
   fan; reading the events against the tags names one for 21. The rollup reads the events.
3. **An unmarked burst.** One session sent 106 shares and 79 plays in 35 seconds without
   `automated`. The rollup now drops any session over one card event a second.
4. **Adam's GUID is in D1.** His clicks on 31 Oct carry his session, so the loader drops that GUID
   from every table.
5. **The D1 join by session id is empty.** No feed session id appears in D1 `clicks`; the join that
   works is the GUID. Ticket purchases join only through the weak aggregate match today.

## For the feed session

The feed, its Worker and `app/feed.html` are the feed session's. Three asks from this workstream:

1. **Mark bursts on write.** A session that sent 106 shares in 35 seconds reached `feed_events`
   without `automated: true`. The rollup filters it; the review and `feed_profiles` do not.
2. **Send the pocket id with ticket clicks.** D1 `clicks.session_id` never equals a feed session id,
   though both are meant to be `pocket_session_id`. Worth checking what the site's attribution
   script writes there, since that join is how a ticket click reaches a fan without a GUID.
3. **When ready, read `fan_record(guid)` in `/api/who`**, so a recognised fan's feed opens on the
   player they finish across every session, not only the last saved pick.

## Roadmap, ranked by what it teaches us

1. **Apply 200, deploy the loader, watch one night.** Check the 08:45 load and the 08:50 rollup
   fired once in production before anyone reports on the record.
2. **Site signals into the record** (workstream 3): the pages a recognised fan reads on the site.
3. **Firm purchase join** (workstream 4): a purchase by GUID or contact id rather than ip and day.
4. **Eloqua fields** Adam names (favourite player, season ticket member) beside the feed's picks,
   so we can see where what a fan told email and what they watch disagree.
5. **A recognised fan's second visit.** No fan has two pocket ids yet; the first one who does is
   the first proof the record follows a fan across devices.
6. **`fan_record` in the dashboard** (workstream 6): recognised fans, fans with a player, fans with
   a ticket click, each by day.
