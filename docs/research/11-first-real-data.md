# 11 — What the first real data showed

Measured 2026-09-19 against the live NFL Cloudinary and the real YouTube channel
(`UCa_FcpOBe8G6VAR18RYS-aA`, Houston Texans), ten Shorts published 13–15 Sept 2026.

## 1. Cloudinary: both remaining questions answered ✅

**`g_auto` works.** The full 4:5 AI content-aware crop returns `HTTP/2 200`. The
one-master-two-aspects design is intact — no focal-point fallback needed.

**Video delivery is reachable.** The `X-Cld-Error` comparison settles doc 09's open question:

| Request | Error |
| --- | --- |
| `/video/upload/texans/bodufcw8x4wotk4q7ses.mp4` | `Resource not found - texans/bodufcw8x4wotk4q7ses` |
| `/image/upload/texans/this-asset-does-not-exist.jpg` *(control)* | `Resource not found - texans/this-asset-does-not-exist` |

**Identical error shape.** The video resource type resolved and reported a missing asset — the
same thing the control said about a deliberately-missing image. An unavailable resource type or
a disabled feature returns a different error, not this one. So the earlier 404 meant *"no video
assets have been uploaded,"* not *"video is off."*

Strong evidence, not proof — one real video public ID would make it certain — but it's enough to
plan on **shape C** from [doc 10](10-video-home.md): a feed-owned store with YouTube as
distribution, using infrastructure already paid for.

## 2. 🚨 Every clip is game footage. This is now the blocking issue.

All ten Shorts are in-game highlights. Touchdowns, sacks, first downs, a fourth-down stop. Not
one is a player feature, a series episode, community, or girls flag.

And every one carries **`licensedContent: true`**.

> **Corrected 2026-09-19 — see [doc 13 §1](13-the-supply-picture.md).** That flag turned out to
> be ~100% across *every* category on this channel, including pressers, radio and girls flag
> football. It is a channel-level content-partner flag, not evidence that a given clip is
> league-claimed game footage. Rights classification must come from content type instead. The
> rest of this section stands: all ten are game highlights, by content.

That collides head-on with the question left open since doc 02: *can NFL game footage live in a
persistent, monetizable, club-owned feed?* It has been the lowest-priority open item on the list.
**On this evidence it is the highest.** If the answer is no, the entire sample is ineligible and
the feed launches with whatever is left — which, in this sample, is nothing.

This doesn't mean stop. It means get the answer before building the ingestion path around
gameday, and in the meantime find out what the non-gameday publishing volume actually looks like.

## 3. The taxonomy may not match what gets published

Auto-classification of the sample:

```
gameday  9    series  1    players  0    community  0    flag  0
```

Two readings, and they need different products:

- **It's a game-week sample.** Three days across one matchup — of course it's all highlights.
  Pull a month and the other four collections fill in.
- **It's representative.** Gameday highlights are the bulk of what the channel ships, and four of
  the five collections are thin.

The second would mean the five-collection model is aspirational rather than descriptive, and the
feed should launch with two or three real ones rather than five mostly-empty shelves. **A month
of channel data settles it** — one API call, no new access needed.

## 4. Smaller findings, all actionable

| Finding | Consequence |
| --- | --- |
| **0 of 10 have caption tracks** (`caption: "false"`) | Accessibility gap. If these edits don't carry burned-in captions either, we need a transcription path — Cloudinary's add-on, or ship captions as a known v1 debt |
| Durations 16–41s, **median 19s** | Very short. Argues for autoplay-through rather than tap-to-play, and makes completion rate a meaningful ranking signal |
| All embeddable, all public, all Shorts-length | Shapes A and B in doc 10 are both technically viable for this content |
| **Descriptions are pure boilerplate** ("Subscribe:… Tickets:…") | Titles are the only real metadata. `cleanDescription()` strips the boilerplate; the feed falls back to the title alone |
| Titles are short, punchy, emoji-led | They work as-is for feed headlines. No rewriting needed — which removes an editorial step |
| API thumbnails are **16:9** (`maxresdefault` 1280×720) | These are vertical Shorts with horizontal posters. `oardefault.jpg` is the Shorts-native vertical frame — not returned by the API, so the feed tries it first and falls back |
| Tags are generic (`Houston Texans`, `2026`) | Useless for classification. Title-based rules only |

## 5. Built on the back of it

- **`src/youtube.js`** — normalizes `videos.list` into ContentItem. ISO-8601 duration parsing,
  boilerplate stripping, Shorts detection by duration (the API has no flag for it),
  title-rule collection guessing, poster-candidate chain, and an `audit()` that surfaces exactly
  the counts in §4 before anything gets published.
- **`tools/build-manifest.mjs`** — reads an API response or fetches live, writes
  `content/manifest.json`, prints the audit to stderr.
- **`content/manifest.json`** — generated from the real ten.
- **`content/samples/youtube-videos.json`** — the payload, kept as a fixture so the normalizer
  has something real to be tested against.
- The prototype now renders **real titles, real durations and real YouTube posters**.

## 6. Worth testing next

**Cloudinary `image/fetch`.** If enabled, it reframes a remote image by URL — meaning YouTube's
16:9 thumbnails could become proper 4:5 tiles with `g_auto`, no uploads at all:

```
https://static.clubs.nfl.com/image/fetch/c_fill,g_auto,ar_4:5,w_400/https://i.ytimg.com/vi/m6gOqjDBXxo/maxresdefault.jpg
```

A 200 means the entire tile rail works today against YouTube content with nothing uploaded
anywhere. It's usually restricted to allowlisted source domains, so it may well 404 — but it's
one request to find out.
