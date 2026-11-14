# Know the fan: the preference layer

The feed's first job is to understand fans better than any other team. Watching tells us a lot;
asking tells us more, faster, and only works if the fan can see what answering bought them. So
every explicit signal does three things at once: it changes the next card, it labels the card
with the reason, and it carries a date or a name the fan recognises.

This document is the design. What is built is marked **live**; the rest is the next build or an
experiment the daily review can run.

## The ask: three taps and two questions

Offered on the third card (an experiment knob), to anyone we can save for (a pocket session or a
device id), once, and again after seven days if they said "not now".

| Step | Question | Why it matters | Status |
|---|---|---|---|
| 1 | **Pick up to three players.** Chips named from the dictionary, most-tagged first. | The strongest single predictor of what a fan will finish. Also the clearest proof the feed listened: "Because you picked Tank Dell." | live |
| 2 | **More of:** Game action · Mic'd up & inside · Fun & TORO · Community · Gameday & tickets. | Lanes map to the catalogue's content types, so one tap moves dozens of cards. "Gameday & tickets" is a declared intent we can act on. | live |
| 3 | **Watch or read?** Mostly video / Mix in articles. | Ranks the site's stories, galleries and podcast against the clips: a mix lifts them with "A read, as you asked" and spaces them every third card; mostly video drops them and spaces them every sixth. | live |
| 4 | **Follow TORO's picks.** | A preset: a named weight set a fan can adopt. A player's own picks need that player's sign-off before the row exists. | live (TORO seeded) |
| 5 | **Time-boxed boost.** "Draft news until Apr 24? Yes." Then back to normal. | The most honest kind of personalization: a promise with an end date, offered when news breaks. Editorial creates the offer; the fan accepts in one tap. | live (needs an offer row) |

Two more questions, each one tap, each tied to a KPI (approved 1 Nov, **live**):

| Question | KPI | What it does |
|---|---|---|
| **"Going to a game this season?"** Yes / Maybe / Not this year | Ticket intent | "Yes" lifts gameday and ticket cards and says "Gameday, since you're going"; "Maybe" nudges the schedule and gameday cards with "Gameday, if you go"; "Not this year" quietly puts every ticket push last, which is itself a kindness fans notice. Stored as `going`. |
| **"How do you watch?"** At Reliant Stadium · At home · On the go | Depth | Shapes pacing without a word: on-the-go fans get clips of 30 seconds or less first, at-home fans the longer ones, stadium fans a gameday nudge. Stored as `watch`. |

## What the fan sees for answering

- **Reason pills** on every card an explicit signal moved: "Because you picked C.J. Stroud", "More fun & TORO, as you asked", "TORO's picks", "Draft news · until Apr 24". Implicit reasons ("Because you watch...") are off by default and an experiment can turn them on.
- **The feed reorders on the spot** after Save and a toast says what came first and why.
- **"Your feed ✎"** chip, always first in the bar once anything is saved: one tap back to the picker, prefilled.
- **A date on every boost**, so the fan knows normal service resumes.

## How the signals combine

Explicit beats implicit. In `src/rank.js`: a picked player is worth 2.0 on a card, a live boost 2.5, a lane 0.8, a followed preset 0.8 × its weights; history (the nightly profile) adds the old affinity score and freshness adds 0.35 at most. A card the fan picked outranks any card their history alone would have chosen. Editorial cards are never moved.

## Keeping the value visible over time

All four approved 1 Nov and **live**. Each is a system card the feed inserts itself, placed by a
knob so the daily review can move or hide it per arm.

- **Weekly "your week" card** (`sys-week`, knob `week_position`, default the fifth slot). "14 clips this week: 9 C.J. Stroud, 3 Will Anderson Jr and 5 TORO skits." Then "Want more?" with up to three one-tap buttons: the lanes behind what they watched but have not asked for, and a player they watched but have not picked. One tap saves it, the feed moves, the toast says what came first. Once a week, and only with five or more views (`feed_week` in Supabase, service key only).
- **Boost expiry card** (`sys-expiry`, knob `expiry_position`, default right after the first card). When a boost's date passes: "Draft news is over. Back to your picks: Will Anderson Jr." with "Got it" and "Edit my feed". Boosts keep the offer's label when saved, so this works after the offer itself has stopped being served.
- **Follow a week** (`sys-offer`, knob `offer_position`, default the picker's slot). A fan who already has a feed meets each live offer as its own card: "Giants week? All things Giants before Sunday. We'll lift it until Nov 9, then your feed goes back to normal." Yes carries the date on the button; No is remembered for seven days. Fans without a feed meet offers inside the picker instead. Editorial or the daily review creates the offer row (`feed_boost_offers`): key, label, blurb, content types, keywords, end date.
- **Contest tied to preferences** (`sys-enter`, knob `capture_card`). `{{player}}` in the headline, blurb or button becomes the fan's first pick, or the page's player on a player page, or "Texans": "Win C.J. Stroud gear" to a Stroud fan. The entry form gets the player's slug in `utm_term`, so Eloqua knows which player drove each entry. The form is `fan_preference_web`.

## Data the program needs next

1. **Email ↔ pocket id**, only through the Eloqua form (NFL privacy block, Adam's language). The hidden `pocket_id` field makes the join possible later; nothing else does.
2. **Ticket intent as a declared field**: `going`, **live**; to be joined to D1 clicks and purchases by session id in the daily review.
3. **Article engagement**: story and gallery cards are live (`source: pocket`), so `card_action` on them is the read signal. **Live.**
4. **Which placement** a session came from (feed, roster, player, schedule), as `feed_placement` on `feed_load`, plus `feed_layout`, `feed_focus` and the returning-fan fields `visit_n`, `returning`, `days_since`. **Live**; see [roster-placement.md](roster-placement.md).

## Privacy

The picker stores pseudonymous preferences against a session id. No name, no email, no account. Personal data is collected only through the Eloqua form, which carries the NFL-approved agreement text above its submit button. The feed never stores what the form collects. The exclusion list (`excluded_players`) applies to picks as to everything else: the dictionary refuses an excluded name, so it can never be picked.

## Knob added 2 Nov 2026: `rail_preview`

Rail layout only. How many lead tiles play a muted, looping preview instead of a still (0 to 3,
default 0). The first review found the rail seen and scrolled past (17 loads, 0 taps by a
person), so the experiment `rail_preview` runs control 0 against preview 1 at 50/50. A preview
is our own file when a master exists, else the Short's embed muted with no controls; it stays
invisible until frames move, takes no taps, pauses while the stage is open, and is skipped for
fans with save-data or reduced motion on. Event: `tile_preview` (card, position, preview_kind),
once per previewing tile. Metric: rail_open per rail feed_load.

## Knob added 3 Nov 2026: `welcome_card`

A fan the handshake recognised (an Eloqua visitor GUID, passed only with Targeting consent) is
asked about once per load through `POST /api/who { guid, sid }`. The Worker answers with what the
feed can act on and nothing else: the picks that fan saved in any earlier session (copied onto
this session, so the ranking is already theirs), or the player they watch most across those
sessions, and whether Eloqua knows the visitor. Never a name, never an email. With something to
say, card 2 is "Welcome!" (never "welcome back", Adam 3 Nov): "Your picks are saved: C.J. Stroud,
Tank Dell. They lead this feed on this device too." with Keep going and Edit picks, or "You have
been watching Tank Dell. Want Dell first?" with one tap that saves the pick (source `welcome`).
Shown once a day. Events: `welcome_shown` (welcome_source picks|watch, welcome_copied),
`welcome_action` (keep|edit|more|skip), `welcome_skipped` (recognised but nothing to show).
Experiment `welcome`: control 0 against welcome 1. Metric: completion and return rate for
recognised sessions against shared.

## Knob added 3 Nov 2026: `pick_prompt`

`card` (default): the picker card at `picker_position`. `chip`: no picker card on its own; after a
fan completes a clip about a player, the next card carries one chip, "More Tank Dell". One tap
saves the pick (source `chip`) without leaving the card, lifts that player's unseen clips to come
next with "Because you picked" on each, and the chip reads "Dell first" for two seconds. Left
alone it fades after seven seconds; the same player is not offered again that day; a system card
never carries one. The picker card stays reachable from the Your feed chip. Events:
`pick_chip_shown` (pref_player, chip_from), `prefs_save` with save_source `chip`.

Also 3 Nov, both arms: a fan who looks at the picker card for a second and swipes past it has
said no; `prefs_swipe` is recorded and the card is not offered again for a day (`txfeed.prefs.swiped`).
Experiment `pick_prompt`: control card vs chip. Metric: saves per fan who completed a player clip.

## Lanes, 3 Nov 2026

Eight lanes, each a name and the content types, themes or collections that put a card in it:
Game action, Gameday hype, Mic'd up & inside, DeMeco & the coaches, Music & 713, Fun & TORO,
Community, Gameday & tickets. Themes are tagged like players, by alias (`feed_entity_aliases`
entity_type `theme`): music (That Mexican OT, 713 Sessions, Johnny Dang, halftime show, ...),
toro, london. The chip offers a lane when the completed clip has no player: "More Gameday hype",
one tap, saved as a want (source `chip`, `pref_lane`), and that lane's unseen cards come next.
An empty lane is never offered. Asked by data: of the 300 Shorts served on 3 Nov, 101 name a
player, 282 carry a content type, 11 are music and 8 are TORO.

## Model tags, 4 Nov 2026

Approved by Adam ("do the small spend"). Two thirds of the served Shorts say "QB1 👆", "Imi is
going to hold it down" or carry the player only as "Tank" in the description, so the alias tagger
sees no player, no chip asks the fan about them, and nothing is learned. The Worker's cron
(`workers/feed/src/tagger.js`, every two hours at :45, after the alias pass at :25) sends the
untagged clips ten at a time to Claude Opus 5.5 at low effort with the alias dictionary in a
cached system block, and writes back only slugs the dictionary knows (so an excluded name can
never come back) as `matched_on = 'model'`, confidence capped at 0.7 so an alias title match
(1.0 / 0.8) always outranks it and nothing existing is overwritten. Every clip asked gets a row in
`feed_model_tag_runs`, found or not, with its share of the tokens and cost; a clip is never asked
twice. The pass stops for the day at `MODEL_TAG_DAILY_USD` (1 dollar; the first run on 4 Nov cost
0.15 cents a clip, 40 clips for 6 cents, so about 650 clips a day) and asks `MODEL_TAG_PER_RUN` (40) per run. By hand, with the upload
key: `GET /api/tag/model?limit=5` is a dry run, `POST /api/tag/model` runs it. `/health` reports
`model_tags`. The review reads `select * from feed_model_tag_report()`.

## Knobs added 4 Nov 2026: `lead_tagged`, `chip_hold`

The 4 Nov review found 82% of card views on cards 1 to 3, the lead card naming no player, and
0 taps on 50 chips. Two knobs, each behind its own experiment:

- `lead_tagged` (0 | 1): the first player-tagged clip among the opening eight moves to card 1,
  so the first completed clip can earn a player chip ("More Tank Dell") instead of a lane.
  Experiment `lead_tagged`, control vs lead, since 4 Nov 12:16 UTC.
- `chip_hold` (0 | 1): the chip stays on its card until the fan swipes instead of fading after
  seven seconds. Experiment `chip_hold`, control vs hold, since 4 Nov 14:05 UTC; only sessions
  in the chip arm of `pick_prompt` see a chip. Both verified live in a session assigned to the
  lead, chip and hold arms.

`welcome` and `capture_pitch` are paused as drafts until twenty fans have saved picks; neither
could show a card while nobody had.

## Knob added 5 Nov 2026: `chip_copy`

`chip_copy` ('more' | 'next'): the chip reads "More Tank Dell" or "Next up: Tank Dell".
Experiment `chip_copy`, more vs next, since 5 Nov 12:00 UTC, after `lead_tagged` was stopped by
its rule (card 1 completion 18.6% against 45.9%: the lead card was a 22-second master in every
lead session against a short site card in control, so card type drove it). The first real chip
tap arrived 4 Nov 17:16 UTC on the news rail, in the hold arm, after the DeMeco card.

## Shipped 8 Nov 2026: the chip and the moving tile are the defaults; `site_rank` added

- `pick_prompt` defaults to `chip`. After 7 days: 432 chips in the chip arm and 1 tap, 186 picker
  views in the control arm and 0 saves with 197 swipes past it; completion 33.5% against 25.7%.
  Neither ask earned picks, so the one that costs the fan nothing and interrupts nothing wins. The
  picker card still opens from the Your feed chip.
- `rail_preview` defaults to 1. After 7 days: the share of rail sessions opening a tile was flat
  (12.4% against 12.7%), but the fans who opened watched more: 356 opens against 258, 132 card
  views against 88, completion 37.9% against 25.0%, 21 plays against 0.
- `site_rank` (0 | 1): a fan the feed has not watched enough to rank (under MIN_EVENTS) but who has
  read about players on the site is ranked on `feed_profiles.site_weights` (the same keys as the
  watch weights). `feed_rank` says `site`. Experiment `site_rank`, control vs site, since 8 Nov.
  On 8 Nov 1,393 profiles carried a site player and 50 carried both site and feed history.

## 9 Nov 2026: two chip experiments stopped by rule; the site rollup runs every two hours

- `chip_hold` stopped (started 4 Nov). 975 control chips and 887 hold chips, 0 taps each; the hold
  arm watched less (3.5 cards and 35.7% completion against 4.0 and 39.2%). Default stays 0.
- `chip_copy` stopped (started 5 Nov). 753 "More X" chips and 961 "Next up: X" chips, 0 taps each,
  so nothing to ship on the metric. The next arm watched deeper (4.1 cards and 39.7% against 3.5 and
  37.3%); that is a depth result, not an ask result, and is worth a retest with depth as the metric
  once an ask that converts exists. Default stays `more`.
- The chip has now shown 1,927 times for one tap. The chip is not the ask that will teach us a fan's
  player; the candidates that need Adam's word are the My Texans page ("mine") and pick'em ("pickem").
- `site_rank` measured nothing on 8 Nov: 4 feed sessions were eligible (site_weights, under
  MIN_EVENTS), 2 in the site arm, and all 4 had read the site the same day, after the 08:20 UTC
  rollup, so none carried site_weights at feed time. `feed_rollup_site()` now runs every two hours
  at :20 (the cron job keeps its name); the lookback is two days so each run touches only recent
  readers. Read site_rank from 9 Nov on.

## 11 Nov 2026: live site weights, and the "Because you read about" pill

The 10 Nov review found that fans who read the site and open the feed mostly do both in the same
visit, minutes apart, so even the two-hourly rollup leaves them without site_weights at feed
time: on 9 Nov the only site-ranked loads were on the news rail and every roster session in the
site arm was ranked shared. Now, when `site_rank` is on, the fan has no picks, the feed has under
MIN_EVENTS on them and the profile has no site_weights, the Worker asks
`feed_site_weights_live(sid)` (sql/410) for weights scored from the fan's own page views of the
last seven days, same scoring as the rollup. `analytics.site` says `rollup` or `live`, and the
page sends it as `feed_site` on feed_load, so the review can read each. Reach on 10 Nov: 8 of 433
roster feed sessions and 12 of 119 rail loads had read about a player before the load.

A profile built from reading carries `source: 'site'`, and `explain()` then labels the moved
card "Because you read about Tank Dell" (kind `read`) instead of "Because you watch". The page
shows `read` pills under the default `reason_pills = explicit`, because reading about a player on
the club's own site is the fan's own act and the pill is the first time a fan can see the feed
listening without having picked anything. Tests: verify-worker (live weights asked with the
service key, only when the knob is on and the rollup has nothing; rollup weights never re-scored)
and verify-rank (the read label).

## 14 Nov 2026: pick'em, the first ask after the chip

Adam, 14 Nov: "my texans page approved pick em approved. tickets rail approved". Pick'em ships
first because the Browns game is on 15 Nov; My Texans follows once pick'em has had its day.

The card (`sys-pickem`, knob `pickem_position`, default -1, the `pickem` experiment arm sets 2)
asks "Who wins Sunday?" with two buttons, Texans and the opponent by name, from six days before
kickoff until kickoff. One tap posts to `POST /api/pick` (pocket or device id, game id, side;
`feed_picks`, one row per fan per game, latest call wins), and the card answers on the spot:
"You and 78% of fans say Texans. Your pick is saved." Not now hides it for that game. A fan who
has called the game never sees the card again for it (`pickem.mine` from the Worker). The feed
JSON carries `pickem` only when the knob shows the card to that fan, so control loads never
touch the picks tables; /health names the game fans can call. qa loads are answered with the
split and never stored. Events: `pick_made` (game_id, pick, pick_share, picks_n), `pick_skip`.
The next game comes from `texans_games` (next kickoff from six hours before now), so the colts
card opens itself on 16 Nov with no row to create.

Why this is the ask after the chip: the chip asks for taste and offers more of the same, and
fans tapped it twice in 4,236 shows. Pick'em asks for an opinion every fan has and pays it back
with the room's answer in the same second. What it teaches us: which fans call games (a ticket
and gameday signal), how confident the base is, and, once the result card lands, a reason to
come back on Monday. Smallest widening next: "You called it" after the final, then the pick
feeding the gameday lane.

Tests: verify-worker (knob off never reads the picks tables; the fan's own call; upsert with the
service key; qa never stored; wrong game 409; wrong side 400; health), verify-pickem.mjs (browser,
PICK_BASE 4404 with pickem_position 2: card third, both sides, tap pays off, pick_made and
pick_skip reported, card gone on the next load, qa flagged, control shows nothing).
