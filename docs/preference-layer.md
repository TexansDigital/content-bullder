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
| 3 | **Watch or read?** Mostly video / Mix in articles. | Stored now, used when article cards join the feed. Immediately useful to email and site teams: the fan told us their format. | live (stored) |
| 4 | **Follow TORO's picks.** | A preset: a named weight set a fan can adopt. A player's own picks need that player's sign-off before the row exists. | live (TORO seeded) |
| 5 | **Time-boxed boost.** "Draft news until Apr 24? Yes." Then back to normal. | The most honest kind of personalization: a promise with an end date, offered when news breaks. Editorial creates the offer; the fan accepts in one tap. | live (needs an offer row) |

Two more questions worth testing, each one tap, each tied to a KPI:

| Question | KPI | How it would work |
|---|---|---|
| **"Going to a game this season?"** Yes / Maybe / Not this year | Ticket intent | "Yes" lifts gameday cards with a ticket action; "Maybe" surfaces the schedule card next; "Not this year" suppresses ticket pushes, which is itself a kindness fans notice. |
| **"How do you watch?"** At NRG · At home · On the go | Depth | Shapes pacing: at-home fans get longer clips earlier; on-the-go fans get a tighter feed and sound-off captions first. |

## What the fan sees for answering

- **Reason pills** on every card an explicit signal moved: "Because you picked C.J. Stroud", "More fun & TORO, as you asked", "TORO's picks", "Draft news · until Apr 24". Implicit reasons ("Because you watch...") are off by default and an experiment can turn them on.
- **The feed reorders on the spot** after Save and a toast says what came first and why.
- **"Your feed ✎"** chip, always first in the bar once anything is saved: one tap back to the picker, prefilled.
- **A date on every boost**, so the fan knows normal service resumes.

## How the signals combine

Explicit beats implicit. In `src/rank.js`: a picked player is worth 2.0 on a card, a live boost 2.5, a lane 0.8, a followed preset 0.8 × its weights; history (the nightly profile) adds the old affinity score and freshness adds 0.35 at most. A card the fan picked outranks any card their history alone would have chosen. Editorial cards are never moved.

## Keeping the value visible over time

- **Weekly "your week" card** (proposal): "This week you watched 14 Tank Dell clips and 3 TORO skits. Want more community content?" One card, one tap, one more signal.
- **Boost expiry card** (proposal): when a boost ends, say so: "Draft week is over. Back to your picks." It closes the loop the offer opened.
- **Follow a week** (proposal): "Follow Giants week": a seven-day boost on the next opponent, offered on the schedule and roster placements.
- **Contest tied to preferences** (ready): the capture card opens the club's Eloqua form at `/enter` with the fan's pseudonymous id in a hidden field. A sweepstakes themed on the fan's picked player ("Win Tank's signed jersey") is the data-capture play with the best odds, because the ask is already about what they told us they love.

## Data the program needs next

1. **Email ↔ pocket id**, only through the Eloqua form (NFL privacy block, Adam's language). The hidden `pocket_id` field makes the join possible later; nothing else does.
2. **Ticket intent as a declared field** (question above), joined to D1 clicks and purchases by session id.
3. **Article engagement**, once article cards exist, to make "Watch or read?" pay off.
4. **Which placement** a session came from (feed, roster, schedule), as a `feed_placement` param on `feed_load`, so the same fan's behaviour can be compared across surfaces.

## Privacy

The picker stores pseudonymous preferences against a session id. No name, no email, no account. Personal data is collected only through the Eloqua form, which carries the NFL-approved agreement text above its submit button. The feed never stores what the form collects. The exclusion list (`excluded_players`) applies to picks as to everything else: the dictionary refuses an excluded name, so it can never be picked.
