# Workstreams for knowing our fans better, run in separate sessions

Written 4 Nov 2026. The feed session (branch `claude/storyteller-social-widget-research-t8b3zp`)
owns the feed, its Worker, the experiments and the daily review. Everything below is a
workstream that can run in its own session at the same time, each on its own branch, each with
its own range of SQL migration numbers so nothing collides.

The objective every workstream is measured against is the one in CLAUDE.md: **know our fans
better than any other organisation.** A workstream earns its place by one of three things: it
teaches us something about a fan we could not know before, it makes a fan feel the club
listened, or it moves a fan toward identifying themselves or toward a ticket.

## How to start a session

1. Open a new session on this repository (claude.ai/code, or the desktop app, or the terminal).
2. Paste the starter line for the workstream, exactly as written below. Each one tells the
   session which files to read first, which branch to use, and which migration numbers are its own.
3. Never paste a key, token or password into the chat. A secret is set with
   `npx wrangler secret put NAME --name <worker>` or in the Supabase dashboard, and the
   session is told it exists.
4. One idea at a time, smallest version first, measured for a day, then widened. The rules in
   CLAUDE.md apply to every session.

Branch names are `claude/<workstream>`. The deploy Action only deploys the feed Worker from
`main` and the feed branch, so another branch cannot change what fans see by accident. A
workstream that needs its own Worker gets its own `workers/<name>` directory and its own Action.

Shared ground every session reads first: `CLAUDE.md`, `docs/preference-layer.md`,
`docs/pocket-id-handoff.md`, `docs/privacy-read-eloqua-guid.md`, `sql/README.md`.

| # | Workstream | What it teaches us | Branch | Migrations |
|---|---|---|---|---|
| 1 | Fan record: one row per recognised fan | Everything we know about one fan in one place, across feed, site, email and tickets | `claude/fan-record` | `sql/200-299` |
| 2 | Eloqua writeback: the feed's picks into the contact | Email that opens with the fan's own player | `claude/eloqua-writeback` | `sql/300-399` |
| 3 | Site signals: every page a recognised fan reads | Taste from the whole site, not only the feed | `claude/site-signals` | `sql/400-499` |
| 4 | Ticket join: which fans buy, and what they watched first | Ticket intent as a fact, not a guess | `claude/ticket-join` | `sql/500-599` |
| 5 | Email entry: recognise the fan who arrives from an email | Identity without a cookie on the first visit | `claude/email-entry` | `sql/600-699` |
| 6 | Fan knowledge dashboard | What the club knows today, in numbers, for leadership | `claude/fan-dashboard` | none |
| 7 | Tag review studio for Juan | Better tags, which means better asks and better picks | `claude/tag-review` | `sql/700-799` |

## 1. Fan record

**Why.** Today a fan is three ids in three places: a pocket id in `feed_events` and
`feed_preferences`, an Eloqua GUID in the `identity` event, a `session_id` in D1 `clicks`. The
objective is one view. The fan record is that view: one row per recognised fan, with their
picks, the players and lanes they finish most, the questions they answered, the pages they
read, the clicks and purchases attributed to them, and the Eloqua contact id when the GUID
resolves. No name, no email, ever: the record is keyed by GUID and pocket id and holds only
what we learned.

**Smallest version.** A nightly `fan_records` rollup in Supabase from `feed_profiles`,
`feed_preferences` and `identity` events, joined to D1 clicks by session id, plus the Eloqua
contact id from the Worker's lookup. A `fan_record(guid)` function the Worker and the dashboard
can call. Then widen with site signals (workstream 3) and tickets (workstream 4).

**Needs from Adam.** Nothing to start. Later: which Eloqua contact fields are worth reading
(favourite player if one exists, season ticket member flag).

**Starter line.**
```
Read docs/workstreams.md and take workstream 1, Fan record, on branch claude/fan-record with migrations sql/200 onward. Read the shared ground first. Build the smallest version: a nightly fan_records rollup keyed by Eloqua GUID and pocket id, holding only learned signals, never a name or an email, with a fan_record(guid) function. Show me the first ten records (ids masked) before widening.
```

## 2. Eloqua writeback

**Why.** The feed now learns a fan's player and lanes. Eloqua holds 1.07 million contacts and
sends the email. Today those never meet. Writing the feed's picks onto the contact (favourite
player, lanes, going-to-a-game answer, last feed visit) lets every email open with the fan's own
player and lets the club segment on what fans actually chose, not what they clicked once.
This is the single biggest "feel listened to" lever outside the feed.

**Smallest version.** Read only first: the Worker's lookup already resolves a GUID to a contact.
Add a dry-run that lists, for recognised fans with picks, what would be written to which field.
Then write one field (favourite player) for contacts that have a pick, nightly, with a log of
every write. Widen to lanes and the going answer once Adam has seen the first writes in Eloqua.

**Needs from Adam.** The Eloqua field names to write to (or the word to create them), and
confirmation the API user may write to contacts. The privacy read covers the GUID; writing a
preference the fan gave us onto their own contact is first-party use, but say so in the record.

**Starter line.**
```
Read docs/workstreams.md and take workstream 2, Eloqua writeback, on branch claude/eloqua-writeback with migrations sql/300 onward. Read the shared ground and workers/feed/src/eloqua.js first. The ELOQUA_SITE, ELOQUA_USER and ELOQUA_PASSWORD secrets exist on the txfeed Worker; never ask for them in chat. Build the dry run first: for recognised fans with saved picks, what would be written to which contact field. Do not write to Eloqua until I name the fields and say go.
```

## 3. Site signals

**Why.** The handshake already runs on every page of houstontexans.com and hands the feed a
pocket id. The feed only learns from the feed. A fan who reads three Stroud articles and a Dell
gallery has told us their players without ever opening the feed. One small beacon on article,
gallery and video pages, carrying the page's own player tags and category with the pocket id,
makes the whole site a listening surface, and the feed's first card can honour it.

**Smallest version.** Extend the handshake block to send one `page_view` event per content
page with the page's tags (the site's own metadata), only with Performance consent, to the
feed's existing events route. Then a nightly rollup into `feed_profiles` so the feed ranks on
it. Measure: the share of first-visit feed sessions that open on a player the fan already read about.

**Needs from Adam.** Where the page's player tags live in the site's markup (a view-source of
one article is enough), and a deploy of the extended handshake block to the header library.

**Starter line.**
```
Read docs/workstreams.md and take workstream 3, Site signals, on branch claude/site-signals with migrations sql/400 onward. Read the shared ground and docs/txfeed-handshake.html first. Build the smallest version: a page_view event with the page's own player tags and category, sent only with Performance consent, into the feed's events route, and a nightly rollup into feed_profiles. Give me the handshake block to deploy and the one article URL you need me to view source on.
```

## 4. Ticket join

**Why.** The objective ends at a ticket. D1 `clicks` carry a session id, an Eloqua GUID and an
NFL device id; `purchases` carry none of the session. Until purchases join to fans, ticket intent
in the feed is a guess (a tap on a ticket card). The join turns it into a fact: which fans bought,
what they watched and picked before they did, and how many days passed.

**Smallest version.** Work out the join key between `clicks` and `purchases` (GUID, device id,
time window) on the existing D1 data, measure how many purchases join, and publish
`fan_purchases(guid)` into Supabase nightly. Then the review can report purchases per feed
session by arm, which is the KPI Adam ranks after preferences.

**Needs from Adam.** Read access to D1 is already in the session's tools. If the ticketing
system can export purchases with an email hash or Eloqua contact id, that export makes the join
exact; say which system it is.

**Starter line.**
```
Read docs/workstreams.md and take workstream 4, Ticket join, on branch claude/ticket-join with migrations sql/500 onward. Read the shared ground first. Cloudflare D1 ht-attribution 99dd013c-9777-4927-a094-4db98c8b5d25 holds clicks (session_id, eloqua_guid, nfl_device_id) and purchases (no session id). Find the join, measure how many purchases join and by which key, and publish fan_purchases(guid) into Supabase nightly. Report the join rate before building anything on it.
```

## 5. Email entry

**Why.** About half of feed sessions carry an Eloqua GUID from the cookie. The other half
include fans who arrive from a club email on a device that has never set the cookie. Eloqua
appends tracking parameters to links; the feed can recognise the fan from them on the first
visit, before any cookie, and open on their picks.

**Smallest version.** Accept Eloqua's link parameters on the feed and the host pages, resolve
them through the existing lookup, store the GUID as the session's identity with the same
consent rule as the cookie, and measure recognised sessions from email versus before.

**Needs from Adam.** One live email with its links, so the exact parameters are known, and a
test send to himself.

**Starter line.**
```
Read docs/workstreams.md and take workstream 5, Email entry, on branch claude/email-entry with migrations sql/600 onward. Read the shared ground and docs/pocket-id-handoff.md first. Build the smallest version: recognise a fan who arrives from a club email by Eloqua's link parameters, under the same Targeting consent rule as the GUID cookie, and report recognised sessions from email per day. Tell me which email parameters you need to see.
```

## 6. Fan knowledge dashboard

**Why.** Leadership will ask what the club knows now that it did not know a month ago. A page
that answers in numbers, every day: recognised fans, fans with a pick, the top picks, answers
per question, identified fans by channel, purchases joined, and the trend of each. Built as a
Claude artifact with the Dashboard type reading Supabase, so it stays live.

**Smallest version.** One page, six numbers and their seven-day trend, from the tables that
exist today. Widen as workstreams 1, 3 and 4 land.

**Needs from Adam.** Who the audience is (one line), so the numbers are the ones they care about.

**Starter line.**
```
Read docs/workstreams.md and take workstream 6, Fan knowledge dashboard, on branch claude/fan-dashboard, no migrations. Read the shared ground first. Build one dashboard artifact from Supabase (feed_profiles, feed_preferences, feed_events, feed_model_tag_report) with six numbers and their seven-day trend: recognised fans, fans with a pick, top five picks, answers per question, identified sessions by placement, model-tag coverage. Brand palette #021018, #ED0028, #0080C6, #FFFFFF. The audience is the Texans leadership team.
```

## 7. Tag review studio

**Why.** Every ask the feed makes rests on a tag: no player, no chip. The model pass now tags
what the alias tagger cannot see, at 0.7 confidence. A page where Juan can accept or reject a
model tag in one tap turns his minutes into better asks: accepted tags rise to 1.0, rejected ones
are removed and fed back into the prompt as examples.

**Smallest version.** A page at `/studio/tags` behind the upload key listing the last 50 model
tags with the clip's title and poster, accept and reject buttons, and a nightly line in the review
with the accept rate.

**Needs from Adam.** Nothing. Juan needs the upload key, which he has for masters.

**Starter line.**
```
Read docs/workstreams.md and take workstream 7, Tag review studio, on branch claude/tag-review with migrations sql/700 onward. Read the shared ground, workers/feed/src/tagger.js and app/upload.html first. Build /studio/tags behind the upload key: the last 50 model tags with title and poster, accept raises confidence to 1.0, reject removes the label and records it in feed_model_tag_runs.rejected. Coordinate the Worker change with the feed session by keeping it to one new file plus one route line in app.js.
```

## What stays in the feed session

The feed page, its Worker, the experiments, the lanes, the chip, the welcome, the capture card,
the masters path, the tagging pass, the daily review. A workstream that needs a feed change asks
for it in its report and the feed session makes it, so the feed never has two authors at once.
