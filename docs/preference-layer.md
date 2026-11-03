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
