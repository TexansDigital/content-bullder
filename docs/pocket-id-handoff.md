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

## Questions

Answers to these change what gets built, so they are worth more than they look.

### 1. Is pocketID also in a cookie?

**This is the big one.** If pocketID is written to a cookie on `.houstontexans.com`, *and*
the feed is served from a subdomain of `houstontexans.com`, then the feed reads it directly —
no script, no handshake, no race, working the moment it is embedded. That would make
everything above unnecessary.

If it is a cookie: what's the name, the domain, and is it set by the server or by JavaScript?

### 2. What is the exact `localStorage` key, and what does a value look like?

One real sample is enough. The feed refuses anything that doesn't match
`[A-Za-z0-9._:-]{6,128}`, so a braced UUID (`{a1b2-…}`), a base64 value containing `+` or
`/`, or anything shorter than six characters would be **silently rejected** and fall back to
a device id. Better to widen the check than to discover that in production.

### 3. When is pocketID minted, and is it ever rotated or reset?

Specifically: is it created on first visit and then left alone, or regenerated on login,
logout, consent change, or a new session? If it rotates, the affinity profile it keys has to
survive the rotation.

### 4. Is the same pocketID used on the Texans app?

The app authenticates fans through Ticketmaster via FanReach, so it may already have a
stronger identity and no need for pocketID at all. Knowing whether the two identifier spaces
overlap decides whether app and web sessions can be stitched before an email exists.

### 5. What origin will the feed be served from?

Needed for `FEED_ORIGIN` above, and it decides whether question 1's shortcut is available at
all. A subdomain of `houstontexans.com` is worth a lot here; an unrelated domain is not.

### 6. Does FORGE allow a script tag on the page?

Decides between Option A and Option B. If the answer is "iframe only", say so early.

### 7. Who owns the privacy sign-off?

Not needed for anything above — the pseudonymous layer carries no personal data. It *is*
needed before the first email address is captured, because a purpose statement written after
you already hold the data is the expensive version. Worth identifying the person now.

---

## One thing to know about durability

If pocketID lives only in `localStorage`, Safari's Intelligent Tracking Prevention caps
script-written storage at **seven days** for sites without recent first-party interaction. A
fan who visits monthly therefore arrives as a new pocketID every time, and any profile keyed
to it starts over.

That is survivable, and it is why the profile should live server-side with pocketID as the
lookup rather than in the browser. But it does mean the ladder — anonymous signal, then an
email once someone has shown what they like — has real urgency. The durable identifier has
to be captured before the pseudonymous one evaporates.

A server-set cookie does not have this problem, which is a second reason question 1 matters.
