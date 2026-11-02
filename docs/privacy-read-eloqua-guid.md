# Privacy read: recognising a fan from the Eloqua visitor id

For whoever signs off privacy for the club. Written 2 Nov 2026 so the question is specific. One
page, one decision.

## What the feed does

The vertical feed on houstontexans.com (the iframe on /feed, the rail on /news) runs inside the
club's own pages. The page already carries an Oracle Eloqua tracking cookie named `ELOQUA`, set
on houstontexans.com, whose `GUID` part is the Eloqua visitor id. For a fan who has ever clicked
a link in a club email on that device, Eloqua already ties that id to their contact record.

Since 2 Nov the page passes that id to the feed together with the anonymous pocket session id.
The feed stores it once per session. Nothing else is read, no email or name travels, and the fan
is not asked anything.

## What it is used for

- To personalise the feed for a fan the club already knows: their picks and what they watch
  follow them, and the content served matches the preferences they gave.
- To build the single view of a fan across web, email, app and Reliant Stadium.

Not used for advertising, not shared with any third party, not sold. The fan can still clear
their picks in the feed at any time.

## How it is gated today

- The id is passed only when the fan has accepted Performance cookies (OneTrust group C0002).
  This is the same gate the site's existing session-attribution script uses, and that script
  already records the same Eloqua id against site sessions.
- Fans who decline optional cookies are never recognised.
- The feed's event rows, where the id lives, are pruned on a 90-day schedule.

## What the club's Privacy Policy already says

The Privacy Policy linked in the site footer (the NFL Privacy Notice with the Houston Texans
supplemental notice) states that the club collects "information collected through cookies, web
beacons, Local Shared Objects, and other technologies" and "information about your interactions
with e-mail messages"; that it "may combine this data with information we already have about
you, including to create inferences about you and your personal preferences"; and that it uses
information to "customize and personalize your experience on the Services and to better serve
you with offers and content that we think may be of interest to you".

## The decisions we need

1. **Coverage.** Does the use above fit under those clauses as written, with no change to the
   notice? Our reading is yes: first-party id, first-party personalisation, already disclosed.
2. **Consent category.** The `ELOQUA` cookie is classified in OneTrust under one category. If
   it is Performance (C0002), the gate is right as built. If it is Targeting (C0004), tell us and
   the gate moves to C0004 in one line.
3. **Retention.** Decided by Adam, 2 Nov: 90 days, the same prune as every other feed event. A
   30-day option exists if the privacy owner asks: resolve the id to a contact nightly, keep the
   resolved key, drop the raw id.

## What is not in scope

Any ask for personal data in the feed (email, name) goes through the approved Eloqua form with
the NFL privacy block shown at the moment of collection. That is already the rule and this note
does not change it.
