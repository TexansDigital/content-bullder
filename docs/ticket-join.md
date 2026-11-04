# Ticket join: which fans buy

Workstream 4. Measured 4 Nov 2026 on D1 `ht-attribution`. Nothing is built on this yet.

## The join

`purchases` carry no session, GUID or device id. `nfl_device_id` is empty on all 13,410 clicks.
The only shared key is the device fingerprint the site and the purchase pixel both write:
`ip_hash` + `ua_hash`. A purchase joins to the latest ticket click from the same fingerprint in
the 30 days before it; that click carries the Eloqua GUID (since 18 Oct) and the pocket session
id (since 31 Oct).

| Window | Purchases | Joined to a click | With a GUID | With a pocket session |
|---|---|---|---|---|
| 18 Oct – 3 Nov (GUID era) | 1,858 | 246 (13.2%) | 226 (12.2%) | 13 |
| 31 Oct – 3 Nov (session era) | 128 | 12 (9.4%) | 12 | 11 |

The 226 GUID purchases belong to 156 distinct fans. 136 of 224 joined within an hour of the
click, 65 within a day, 23 later. The existing `attributions` table is mostly `aggregate`
(930 of 1,062): matched by event and time, not person, so it is not a fan join.

Before 18 Oct nothing joins: the click table had no GUID and few rows.

## The feed side

Clean feed data (qa, automated, Adam's session and test sessions excluded): 446 sessions since
1 Nov, 191 GUIDs since 2 Nov. Of those 191, 3 ever clicked a ticket link, 7 appear in
`site_sessions`, **0 joined to a purchase**. Purchases per feed session by arm cannot be reported
yet: the numerator is zero.

## Why the rate is low

1. Ticketmaster checkout runs on a different domain; a fan who reaches it from an app, an email
   or a bookmark never makes a click on houstontexans.com.
2. IP changes between click and purchase (phone on cellular, then wifi) break the fingerprint.
3. Identical iPhone user agents behind one carrier IP can match the wrong person; `confidence`
   marks gap length so the low rows can be dropped.

## What would make it exact

An export from the ticketing system (Ticketmaster Account Manager / Archtics) carrying, per
order, the Eloqua contact id or a SHA-256 of the lower-cased email. Joined to Eloqua, that names
the buyer's GUID without a fingerprint.

## Built, not applied

- `sql/500-fan-purchases.sql`: `fan_purchases` (no name, email or order number; 90-day prune)
  and `fan_purchases(guid)`, service role only.
- `workers/ticket-join`: nightly cron, upserts the join. Needs the migration applied, a deploy
  and `SUPABASE_SERVICE_KEY` set on the Worker.
