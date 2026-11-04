# Eloqua writeback: the feed's picks onto the contact

Workstream 2 in [workstreams.md](workstreams.md). Branch `claude/eloqua-writeback`, migrations
`sql/300` onward, Worker `workers/eloqua-sync`. Written 4 Nov 2026.

**Decided by Adam, 4 Nov 2026:** the picks land in an Eloqua custom data object (CDO), not on
contact fields. Adam creates the CDO. Daily is fine. Go.

## Why

The feed learns a fan's player, lanes and whether they are going to a game. Eloqua holds the
contact and sends the email. Today those never meet. Writing the picks onto the contact lets
every email open with the fan's own player and lets the club segment on what fans chose, not
what they clicked once. It is the biggest "the club listened" lever outside the feed itself.

## The dry run, 4 Nov 2026

Clean sessions only: a session is out, whole, if any of its events says `qa` or `automated`, if
it is Adam's own, or if its id contains `smoketest`, `armcheck` or `test`.

| Number | Value |
|---|---|
| Sessions that carried an Eloqua GUID (clean, since 1 Nov) | 186 |
| Distinct GUIDs | 188 |
| GUIDs seen on more than one session | 0 |
| GUIDs with a watch profile of six or more events | 2 |
| GUIDs with a player the feed saw them watch | 1 |
| Saved preference rows in total | 7 |
| Saved preference rows from a real fan | **0** |
| **Contacts the dry run would write today** | **0** |

Every saved pick in `feed_preferences` is Adam's QA (loads marked `qa`, placeholder GUID) or a
test session. The picker is three days old and the real fans it has reached have swiped past it
(10 swipes, 0 saves outside QA). So the dry run is built, tested against a model of the data,
and empty in production. The first real save by a recognised fan makes it one row.

Also seen: no GUID has yet returned on a second session, so the recognised fan's picks have
never had the chance to follow them. The writeback is what makes the picks follow them into
email before they return to the site.

## The CDO Adam creates

Name it **Feed Preferences**. The Worker finds it, and each field, by name, so no id is typed by hand.

| Field | Type | Needed | What goes in it |
|---|---|---|---|
| Contact ID | Text | yes | The Eloqua contact id. Set it as the unique code field and map the CDO to contacts on it |
| Favorite Player | Text | yes, live now | The fan's first pick, display-cased: `C.J. Stroud` |
| Updated At | Date | optional | When the feed last wrote the record |
| Players | Text | later | All picks: `C.J. Stroud \| Tank Dell` |
| Lanes | Text | later | The lanes they asked for: `Fun & TORO \| Gameday & tickets` |
| Going | Text | later | "Going to a game this season?" `yes`, `maybe`, `no` |
| Watch | Text | later | "How do you watch?" `stadium`, `home`, `go` |
| Format | Text | later | `video`, `read`, `both` |
| Last Feed Visit | Text | later | The date of the last feed load: `2026-11-03` |

Smallest version first: Favorite Player alone (`ELOQUA_CDO_SIGNALS` in `wrangler.toml`). The
later signals are planned and logged as `dry` every night, so widening is one line once Adam has
seen the first records land.

Why a CDO serves the objective better than contact fields: the feed's knowledge sits in its own
record joined to the contact, so it can grow (lanes, going, watch, later a watched player and
ticket intent) without touching the contact schema. One record per contact means two devices,
two GUIDs, one fan: the newest picks win and the older GUID is logged as merged.

Picks on `excluded_players` are dropped before they reach the plan. Boosts whose date has
passed are not carried.

## How it runs

`workers/eloqua-sync`, its own Worker and its own Action, so a change here can never change what a
fan sees. Daily at 09:05 UTC, after the feed's rollup and prune. The pass:

1. `feed_eloqua_candidates()` in Supabase (service key only).
2. The GUID resolves to a visitor on REST 2.0, the visitor to a contact, through the feed's own
   `workers/feed/src/eloqua.js`, unchanged. Only the contact id is read.
3. The CDO and its fields are found by name on REST 2.0.
4. The first time, one record is created (`POST .../customObject/{id}/instance`) linked to the
   contact; its id is kept in `feed_eloqua_cdo_records`. After that the same record is updated
   (`PUT .../instance/{id}`). A value the record already holds is `unchanged` and never sent.
5. Every planned row is logged to `feed_eloqua_writes` with the CDO id, the record id and the
   previous value, so any write can be undone.

It writes nothing until all of these hold: `WRITE_ENABLED` is `1` (it is), the CDO exists with
the Favorite Player field, and the Worker's secrets are set. Missing any one, each fan's row says
which in the log.

`GET /cdo` shows what the Worker sees: the CDO's id, its fields, and which signals land.
`GET /dry-run` runs the whole plan without writing.

## Privacy, in one paragraph

The GUID read is covered by the privacy read of 2 Nov (`privacy-read-eloqua-guid.md`): the Eloqua
pixels are approved for personalisation, the GUID is gated on Targeting consent (C0004), and the
raw id is pruned at 90 days. Writing a preference the fan gave us, in our own feed, onto their
own contact in our own system is first-party use of first-party data for the stated purpose
("customize and personalize your experience... content that we think may be of interest to
you"). It is recorded here as such. No third party sees it. The fan can change or clear the pick
in the feed, and the nightly pass carries the change.

## Next, for knowing fans better

- **A watched player, labelled as inferred.** Zero recognised fans have saved a pick, but the feed
  already knows what some of them watch. A `Watched Player` field, kept apart from the declared
  pick, would give email a player for fans who never open the picker.
- **Going as a ticket segment.** Once `Going` is live, `yes` and `maybe` are a declared ticket
  intent list in Eloqua, joined to workstream 4's purchases.
- **The feed has to earn the first save.** Every recognised fan so far has swiped past the picker.
  The writeback has nothing to carry until the welcome card or the chip lands a save; that is the
  feed session's lever.
