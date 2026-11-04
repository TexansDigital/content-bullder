# Eloqua writeback: the feed's picks onto the contact

Workstream 2 in [workstreams.md](workstreams.md). Branch `claude/eloqua-writeback`, migrations
`sql/300` onward, Worker `workers/eloqua-sync`. Written 4 Nov 2026. Read only until Adam names
the fields and says go.

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

## What would be written

One row per contact field, the newest preference row across all of a fan's sessions, from
`feed_eloqua_candidates()`:

| Signal | Value, as the fan would recognise it | Example |
|---|---|---|
| `favorite_player` | The first pick, display-cased | `C.J. Stroud` |
| `players` | All picks, newest row, bar-separated | `C.J. Stroud \| Tank Dell` |
| `lanes` | The lanes they asked for, named as on the card | `Fun & TORO \| Gameday & tickets` |
| `format` | `video` or `read` or `both` | `video` |
| `going` | "Going to a game this season?" | `yes`, `maybe`, `no` |
| `watch` | "How do you watch?" | `stadium`, `home`, `go` |
| `last_feed_visit` | The date of the last feed load on a recognised session | `2026-11-03` |

Smallest version first: `favorite_player` alone, nightly, then widen once Adam has seen the
first writes land in Eloqua. The others are planned and logged as `dry` from day one so the
widening is a one-line map change.

Picks on `excluded_players` are dropped before they reach the plan, the same rule the feed
applies everywhere. Boosts whose date has passed are not carried.

## How it runs

`workers/eloqua-sync`, its own Worker and its own Action, so a change here can never change what a
fan sees. Nightly at 09:05 UTC, after the feed's rollup and prune. The pass:

1. `feed_eloqua_candidates()` in Supabase (service key only).
2. The GUID resolves to a visitor on REST 2.0, the visitor to a contact on REST 1.0, through the
   feed's own `workers/feed/src/eloqua.js`, unchanged.
3. Each signal becomes one planned write: field, value, and the contact's current value.
4. Every planned row is logged to `feed_eloqua_writes` as `dry`. With `WRITE_ENABLED=1` and the
   field in `ELOQUA_FIELD_MAP`, the mapped fields are `PUT` on the contact and the row says
   `written`, with the previous value kept so any write can be undone. A value the contact
   already holds is `unchanged` and never sent.

`GET /dry-run` runs the plan by hand. `GET /fields?q=player` lists the contact fields Eloqua
already has whose name matches, so the map can be named from what exists.

What the log holds: the GUID, the contact id, the field, the two values. Never a name, never an
email. The contact read asks only for the mapped fields.

## Privacy, in one paragraph

The GUID read is covered by the privacy read of 2 Nov (`privacy-read-eloqua-guid.md`): the Eloqua
pixels are approved for personalisation, the GUID is gated on Targeting consent (C0004), and the
raw id is pruned at 90 days. Writing a preference the fan gave us, in our own feed, onto their
own contact in our own system is first-party use of first-party data for the stated purpose
("customize and personalize your experience... content that we think may be of interest to
you"). It is recorded here as such. No third party sees it. The fan can change or clear the pick
in the feed, and the nightly pass carries the change.

## Needs from Adam before any write

See the questions at the end of the report that opened this branch. In short: the field names
(or the word to create them), confirmation the API user may update contacts, the go.
