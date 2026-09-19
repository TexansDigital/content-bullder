# 13 — The supply picture, at real scale

1,000 uploads, 21 Dec 2025 → 18 Sept 2026. 271 days, **3.7 videos/day**. Channel has 6,403
total. Source: `content/samples/channel-1000.json`.

## 1. Correction: `licensedContent` is not a rights signal

[Doc 11](11-first-real-data.md) read `licensedContent: true` on all ten Shorts as evidence of
league-claimed game footage. **That was wrong**, and the full sample shows why:

| Collection | n | licensed |
| --- | --- | --- |
| gameday | 645 | 98% |
| presser | 164 | **100%** |
| series | 73 | **100%** |
| radio | 55 | **100%** |
| players | 35 | **100%** |
| community | 17 | 94% |
| flag | 11 | **100%** |

It's ~100% across *every* category — press conferences, radio interviews, girls flag football.
It's a channel-level flag (the channel is linked to a YouTube content partner, so uploads get
claimed), not a content-type one. And the 14 videos that *aren't* flagged are almost all
highlight compilations — "Top 10 Texans Plays | 2025 Season", "Every Defensive Touchdown in
2025" — the exact opposite of the reading.

**Consequence:** rights classification has to come from content type, not from this field. The
NFL game-footage question is unchanged and still open; we just can't answer it from the API.

## 2. The vertical pool is healthy — until you subtract gameday

```
vertical-native (<=180s, deduped)   661      ~17/week
  gameday                           585
  NON-gameday                        76      ~2/week
```

**17 vertical clips a week is a real feed.** Two a week is not — a feed that gains two items
weekly reads as abandoned.

So the whole product hinges on the gameday rights answer in a way nothing else does. That's now
measured rather than inferred.

## 3. But the non-gameday verticals are the *best* content

```
series      39    ~4.3/month
players     19    ~2.1/month
radio       10    ~1.1/month
community    5    ~0.6/month
flag         3    ~0.3/month
```

What they actually are:

> `Family time 🫶 | ISI ep. 2` · `Fishing, family, and football | ISI ep. 2` ·
> `It's special 🤩 | Mic'd Up` · `Take a look behind the scenes with Nico 👀` ·
> `Trent Brown Trades the Trenches for the Ranch 🤠` · `Teller knows his BBQ 🍖` ·
> `Reed 🤝 TORO` · `From the 8th round to the NFL` · `WE'RE SO BACK‼️`

This is personality-driven, feed-native, rights-clean content with recurring franchises (`ISI`,
`Mic'd Up`). It is *better* suited to a persistent branded feed than highlights are — highlights
are commodity and fans get them everywhere; Trent Brown at his ranch they get in one place.

The problem is purely volume: 4.3 a month.

## 4. The clipping reservoir is the answer, and it's large

Duration distribution across the 1,000:

```
<=15s     189  ████████████████
16-30s    186  ████████████████
31-60s    163  ██████████████
61-180s   123  ██████████
3-10m     137  ███████████
10m+      202  █████████████████
```

Bimodal — short social cuts and long pressers/streams, little between. **339 videos are over
three minutes.** 164 of those are pressers, 55 radio, 73 series.

A 20-minute presser holds four or five genuinely good 20-second answers. At even three clips
each, the 164 pressers in this window represent **~500 vertical clips a year with no game
footage in them at all.**

That turns the launchable supply from ~2/week to something like ~10/week — without touching the
blocked category and without waiting on the rights answer.

**This is the project.** Not "surface what we already posted" — that path is either gameday
(blocked) or 2 items a week (dead). The product is **a clipping tool that mines long-form into
vertical**, with the existing 76 non-gameday verticals seeding it and gameday folded in later if
rights permit.

It's also, precisely, what Storyteller sells as ClipCrop — which makes "buy that piece" a much
more serious option than it looked three docs ago.

## 5. Captions: worse at scale

**20 of 1,000 have a caption track. 2%.**

At a median of 50 seconds with audio carrying most of these clips, shipping with no caption path
is a real accessibility decision, not an oversight to discover later. Options unchanged
(Cloudinary transcription, a Whisper-class worker, burned-in captions in the edit) but the number
argues for deciding deliberately now.

Worth checking whether the social edits carry burned-in captions — if they do, the gap is
cosmetic; if they don't, it's real.

## 6. Taxonomy, revised again

Over 9 months rather than 11 days, all five original collections do have supply — community (17)
and girls flag (11) are seasonal, not absent. Doc 12's "launch with three" was drawn from too
thin a sample.

Revised recommendation: **Gameday · Series · Pressers · Players · Texans Radio** as standing
collections, with **Community & Foundation** and **Girls Flag & Youth Football** appearing when
they have content. `series` deserves promotion — 73 videos and the recurring franchises are the
strongest feed material on the channel.

## 7. Open, in priority order

1. **NFL game-footage rights.** Measured stakes now: it is 88% of the vertical supply.
2. **Are pressers rights-clean?** Not game footage, so presumably yes — but it's the assumption
   the clipping plan rests on, so confirm it rather than assume it.
3. **Do the social edits carry burned-in captions?** Decides whether 2% is a real gap.
4. **Who clips?** A clipping tool is a bigger behaviour change than an approval queue. Whose job
   is it, and how many minutes per presser do they have?
