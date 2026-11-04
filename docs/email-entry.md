# Email entry: recognise the fan who arrives from a club email

Workstream 5, branch `claude/email-entry`, migrations `sql/600-699`. Written 4 Nov 2026.

## What the data said before anything was built

Checked on 4 Nov 2026. The site's own records are in D1 `ht-attribution` `site_sessions`, and the
feed's are in Supabase `feed_events`. Our own traffic was left out (qa, automated, Adam's session,
and test, smoketest and armcheck ids).

| Fact | Number |
|---|---|
| Site sessions from a club email in 14 days (`utm_source=01&utm_medium=em`) | 5,144 |
| ... of which carried an Eloqua GUID | 2,205 (43%) |
| ... of which landed on a feed page | **0** |
| Feed sessions in the week to 4 Nov | 471 |
| ... with an Eloqua GUID | 200 |
| Distinct feed GUIDs | 191 |
| ... also seen in a site session that came from email | 3 |

Club email links carry the club's own code in `utm_content`, for example
`em0000e7_261102_-2026-8_14_03_14___em-01_howtowatchchargers`: an email id (`em0000e7`), the send
date, and a name. The site does not record Eloqua's own link parameters (`elqTrackId`, `elq`,
`elqaid`, `elqat`, `elqCampaignId`), so whether live links carry them is **not yet known**.

**What this means for the objective.** The brief was to recognise fans who arrive at the feed
from email. Today that number is zero, because no email links to the feed. Building recognition
alone would measure nothing. So the smallest version has two parts:

1. The fan who lands on an article from email keeps that arrival for the rest of the visit. When
   they meet the feed later in the same tab, the feed knows which email brought them.
2. One feed link goes into one email, so there is a first number to read.

## The smallest version

| Piece | Where | Owner | What it does |
|---|---|---|---|
| Handshake v5 | `proposals/email-entry/txfeed-handshake-v5.html` | Adam deploys, replacing `tx-feed-handshake-block` | Reads the email arrival from the landing URL and keeps it in `sessionStorage` for 30 minutes, under Performance (C0002). Answers the feed's hello with `email: {id, name, campaign, asset}`. Adds `elq: true/false` (were Eloqua's own link parameters present?) only under Targeting (C0004). No raw `elq` or `elqTrackId` value ever leaves the page |
| Feed page | `app/feed.html`, in `proposals/email-entry/feed.diff` | feed session | Puts `email_*` on the identity event. Asks `/api/who` once for every session with a GUID, in every arm, and records `who_result` (`who_known`, `who_via`, `who_contact`, plus the email fields). Sends `copy: false` when no welcome card will show, so the control arm is counted but its feed is not changed. Reads `utm_*` from its own URL when an email links straight to `/feed` |
| Worker | `workers/feed/src/app.js`, same diff | feed session | `/api/who` adds `known_via` (`history` or `eloqua`) and `contact` (a boolean: Eloqua has tied this visitor to a contact). The contact id never leaves the Worker. It also honours `copy: false` |
| Local twin | `server.mjs`, same diff | feed session | One fixture GUID answers as an email-recognised contact, for the page suite |
| Report | `sql/600-feed-email-entry.sql` | this workstream | `feed_email_entry_daily(days)` gives per Houston day: sessions from email, how many had a GUID, how many were recognised, and how many matched a contact, against all other sessions. `feed_email_entry_by_email(days)` gives the same per email. `feed_email_entry_sessions(days)` gives the session rows. Service key only. The exclusions are built in |

**Consent.** Recognition (the GUID, and the elq flag) stays under C0004, exactly as in v4. The
email id and name are campaign attribution, the same thing the site's session-attribution script
already records as `utm_content` under C0002. They are what lets us count email arrivals who
could *not* be recognised, which is the denominator. If the privacy owner prefers, move the email
fields under C0004 by changing one line in the block (`consent === true` becomes
`hasGroup(GUID_GROUP) === true`).

**What the fan sees.** Nothing changes. No card is added or moved, and the welcome card behaves
exactly as before in both arms. The first-fan walkthrough is therefore not required for this
deploy. Run it anyway if the feed session ships anything else alongside.

## What the feed session applies

```bash
git fetch origin claude/email-entry
```
```bash
git checkout origin/claude/email-entry -- proposals/email-entry test/verify-email-entry.mjs test/verify-email-entry-worker.mjs test/verify-email-entry-page.mjs sql/600-feed-email-entry.sql
```
```bash
git apply proposals/email-entry/feed.diff
```

Then run the suites. The first two need no server:
```bash
node test/verify-email-entry.mjs
```
```bash
node test/verify-email-entry-worker.mjs
```
The page suite needs the local server on 4400:
```bash
node test/verify-email-entry-page.mjs
```
Also rerun `verify-welcome.mjs`, `verify-welcome-page.mjs` (server on 4401 with
`FEED_KNOBS='{"welcome_card":1}'`) and `verify-identity.mjs`. All passed here on 4 Nov
(17, 8, 14, 13, 13, 31).

Then deploy the Worker and run `sql/600` in the SQL editor. Adam replaces the header block with
handshake v5. Coordinate with workstream 3, which also extends the handshake: one v5, not two.

**Day one check.** After deploy, one `?qa=1` load from an email link with a GUID must show an
identity event with `email_id` and a `who_result`. Then wait for the first real `who_result`
before reporting any number.

## What I need from Adam

1. **One live email's links.** Forward one recent club email to yourself and copy the full URL
   of two of its links (right-click, Copy link) before clicking. I need to see whether Eloqua adds
   `elqTrackId`, `elq`, `elqaid`, `elqat` and `elqCampaignId` beside the `utm_*` we already see,
   and what the click-tracking redirect domain is.
2. **A test send to yourself** of that email. Click one link on a phone that has never visited
   the site, accept all cookies, then open `/feed?qa=1`. Tell me the time. I will check that the
   GUID resolved to your contact on the first visit.
3. **One feed link in one email.** "Your feed: the clips you watch most, in one place" →
   `houstontexans.com/feed`. Without it, email arrivals reach the feed only by wandering there.

## Roadmap: what would know fans better next

- **Recognise without the cookie.** If the test send shows the `elq` recipient id on links, the
  Worker can resolve it through Eloqua, which would cover the 57% of email arrivals with no GUID.
  Build this only once the parameter has been seen and resolved once.
- **Open the feed on the email's subject.** A fan who clicks "How to watch Chargers" lands on a
  feed that leads with Chargers week, labelled "From your email". This is the first proof that
  email and feed listen to each other.
- **Personal email to personal feed.** With workstream 2 (writeback), the email names the fan's
  player and links to the feed opening on that player: one loop across email and site.
- **The ticket step.** Email arrivals who are recognised and then tap a ticket card, joined to
  purchases through workstream 4.
- **The site's email arrivals as a signal.** 5,144 arrivals in 14 days each name an email. Joined
  by GUID to `feed_profiles`, each one says which topics a fan chose to open, before they ever
  open the feed.
