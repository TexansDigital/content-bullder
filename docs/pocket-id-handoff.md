# Handing pocketID to the feed

For whoever owns the houstontexans.com page that will carry the vertical feed embed.

## What this is for

The feed is an iframe. We want each session's events — a card viewed, liked, shared,
completed — tied to the same anonymous visitor the rest of the site already knows, so
preferences accumulate against one identity instead of a second, parallel one.

The site already mints that identity: **pocketID**, kept in `localStorage`.

## Why the feed can't just read it

`localStorage` is scoped per origin. The feed is served from a different origin than
`www.houstontexans.com`, so it reads its own empty store, not yours. Nothing the feed does
can change that — the value has to be handed across deliberately.

There are two ways to do it. **Either one is enough; you do not need both.**

---

## Option A — the script (preferred)

The feed posts a `hello` message to its parent as soon as it loads. The host page answers
with the pocketID. That's the whole protocol.

Set `FEED_ORIGIN` to the origin the iframe is actually served from, and `POCKET_KEY` to the
real `localStorage` key — the script does nothing if either is wrong.

```html
<script>
(function () {
  var FEED_ORIGIN = 'https://REPLACE-ME';
  var POCKET_KEY  = 'REPLACE-ME';

  window.addEventListener('message', function (e) {
    if (e.origin !== FEED_ORIGIN) return;
    if (!e.data || e.data.source !== 'txfeed' || e.data.event !== 'hello') return;
    var id = null;
    try { id = localStorage.getItem(POCKET_KEY); } catch (err) { id = null; }
    if (!id) return;
    e.source.postMessage({ source: 'txfeed-host', pocketId: id }, FEED_ORIGIN);
  });
}());
</script>
```

### What it does, line by line

| Step | Why |
| --- | --- |
| Listens for `message` | The feed cannot call into the host page; a message is the only channel |
| Checks `e.origin` | So the page only answers our feed, not any other frame that asks |
| Checks `source` and `event` | Ignores every other message on the page — analytics, chat widgets, video players all use this channel too |
| Wraps `localStorage` in try/catch | It throws in some privacy modes rather than returning null |
| Returns early on no id | Sending null would be worse than sending nothing; the feed falls back cleanly |
| Replies with `FEED_ORIGIN`, not `'*'` | So the value cannot leak if that frame navigates somewhere else |

### What it does NOT do

- It does not send anything until the feed asks.
- It does not read or write anything other than that one key.
- It does not set cookies, and it does not run on pages without the embed.

---

## Option B — the URL, if the page can't run script

If FORGE won't allow a script tag on the page, put the value on the iframe's `src` instead
and the feed will use it with no handshake at all:

```html
<iframe src="https://REPLACE-ME/feed?pid=THE_POCKET_ID" width="100%" height="820"
        style="border:0" title="Texans feed"></iframe>
```

This only works if the page can interpolate the value server-side or in a template. It is
otherwise identical in effect.

---

## What the feed does with it

- Holds its first events for up to **1.2 seconds** waiting for the reply, so the two most
  valuable events in a session — the feed loading, and the first card actually seen — are
  not recorded anonymously.
- Flushes regardless after that. **A host that never answers does not cost us the session**;
  it just gets attributed to a feed-minted device id instead.
- Shape-checks the id against `[A-Za-z0-9._:-]{6,128}` and ignores anything else.
- Treats it as a **pseudonym and a claim, not proof of identity.** It arrives from a frame
  we do not control, so it is never used on its own to reach an account or an order history.
  Resolving a pocketID to a person needs a signed token and a stated purpose, and that is a
  separate, later, deliberate step.

Nothing personal is transmitted. The events carry card ids, collection names, positions and
durations — no names, no addresses, no ticketing data.

---

## Answered, 2026-10-29

| Question | Answer |
| --- | --- |
| Cookie? | **No.** `session-attribution` writes pocketID to localStorage only, so the subdomain shortcut is unavailable and the Safari seven-day cap applies |
| Key | `pocket_session_id` |
| Format | `sess_<ms timestamp>_<9 random>`, e.g. `sess_1792089626000_k3j9xq2ab` — ~28 chars, passes the feed's check unchanged |
| Rotation | Created only when absent, never rotated. Lost on cleared storage, Safari's cap, or private browsing |
| Consent | **Gated on OneTrust performance consent (C0002).** A visitor who has not consented has no pocketID |
| App | The iOS app's webview has separate storage, so an app visitor gets a different pocketID. Stitching goes through the app's Ticketmaster login |
| Profile store | `ht-attribution` already has a `site_sessions` table keyed on this id |
| Race | Header scripts run before page content, so the listener is ready before the feed's `hello` |

## Where the block lives

Its own Html Content module in the `integrations` slot of `~/_libraries/_header`, alongside
`elq-loader-fix` and `session-attribution`. Inline script runs from that slot, so the
`?pid=` fallback is not needed. The shipped block is [`txfeed-handshake.html`](txfeed-handshake.html).

## Still open

1. **The feed's origin.** `FEED_ORIGIN` must be set or the block does nothing.
2. **Whether a page body slot also accepts an Html Content module.** The header slot proves
   inline script runs; it does not prove an iframe can be placed in a content page. Different
   slot, different question.
3. **Privacy sign-off owner.** Not needed for the pseudonymous layer, which carries no
   personal data. Needed before the first email address is captured.
