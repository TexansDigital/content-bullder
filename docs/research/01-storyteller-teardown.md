# 01 — Storyteller teardown

What Storyteller ([getstoryteller.com](https://www.getstoryteller.com/)) actually ships, and
therefore what "bring in Storyteller's other features" concretely means.

> Their marketing site and docs site are blocked from this environment's network. Everything
> marked **[verified]** below was read directly out of their **published npm package**
> (`@getstoryteller/storyteller-sdk-javascript@10.13.16`, published 2026-09-15, 135 versions
> since 2022-05-11) and their **public GitHub org**. That's primary source — it's their real
> shipping API surface, not a brochure.

## 1. Product shape

Two content formats:

- **Stories** — tap-through, 9:16, full-screen, sequential *pages*. The Instagram-Stories model.
- **Clips** — vertically swiping full-screen video feed. The TikTok / Reels model.

Both are surfaced through **six drop-in view components** [verified]:

| Component | What it is |
| --- | --- |
| `StorytellerStoriesRowView` | Horizontal rail of story bubbles (`cellType: round \| square`) |
| `StorytellerStoriesGridView` | Grid of story tiles |
| `StorytellerClipsRowView` | Horizontal rail of clip tiles |
| `StorytellerClipsGridView` | Grid of clip tiles |
| `StorytellerClipsPlayerView` | Full-screen vertical swipe player |
| `StorytellerEmbeddedClipsPlayerView` | The same player embedded inline in a page |

Configuration per view [verified]: `categories[]` (stories) or `collection` (clips),
`displayLimit`, `cellType`, `theme`, `uiStyle`, `basename`.

**This is the answer to the 4:5 vs 9:16 question.** They're two different decisions:
the *tile* in the rail/grid can be round, square or rectangular (their theme tree has a
`rectangularTile` branch), and the *player* is always full-bleed 9:16. A 4:5 "promo card"
in a page is a tile treatment; 9:16 is the playback experience. We'd want both.

## 2. Content model [verified]

```
Story
  externalId, id, shortCode
  titles, thumbnails { small, medium, large }, profilePictureUrl
  categories[], sortOrder, isPinned, isLive
  publishAt, timestamp
  isSponsored, sponsorId
  webStoryUrl, googleWebStoryUrl        <- SEO-indexable web story per story
  pages[]

Page
  type: image | video | poll | triviaQuiz
  background { type: image|video, url, playcardUrl }
  duration, sortOrder, skippable
  action / swipeUpType / swipeUpUrl / swipeUpText / showSwipeUpUi
  appStoreId, playStoreBundleId          <- app-store swipe-ups
  deepLink, deepLinkInternal, deepLinkExternal
  captions[] { languageCode, remoteUrl }, subtitle.vtt
  engagementUnit, shareMethod
```

Note `externalId` on both stories and clips, and `openStoryByExternalId` /
`openClipByExternalId` in the API — **that's the hook for keeping our IDs (an IG media id,
a MAM asset id) as the primary key.** Important if we ever want to migrate off them.

## 3. "Other features" — the full list

- **Engagement units**: polls, trivia quizzes, outcome quizzes, emoji sliders [reported];
  `PageType` enum confirms `poll` and `triviaQuiz` as first-class page types [verified].
- **Categories & Collections**: stories group into categories, clips into collections.
  Categories can be made **followable** so a fan follows a player or a content strand and
  it weights their feed [reported].
- **Live**: `isLive` on stories, and a "Live Clips" concept [verified/reported].
- **Scheduling**: `publishAt`, plus CMS scheduling and preview [verified/reported].
- **Deep linking**: `openStory`, `openPage`, `openCategory`, `openCollection`,
  `openClipByExternalId` — so a push notification or a marketing link can open a specific
  clip inside the app [verified].
- **Theming**: a deep light/dark design-token tree — `colors`, `font`, `primitives`,
  `lists`, `storyTiles`, `player`, `clipPlayer`, `buttons`, `instructions`,
  `engagementUnits`, each with sub-themes [verified]. Brandable to our palette without
  forking.
- **Captions**: per-page caption tracks + VTT [verified].
- **Likes and share**: `likedClip` / `unlikedClip` / `shareSuccess` events [verified].
- **Ads**: Google **IMA** SDK is bundled in the web player (284 references) and they ship
  separate **GAM** and **VAST** Swift modules on GitHub — so it's real VAST/VPAID ad
  insertion into the feed, not just "sponsored content" flagging [verified].
- **Analytics**: ~45 tracked activity types [verified], including `openedStory`,
  `completedStory`, `votedPoll`, `triviaQuizCompleted`, `likedClip`, `completedLoop`,
  `nextClip`, `enabledClipCaptions`, and full ad quartile tracking
  (`viewedAdPageFirstQuartile` → `viewedAdPageComplete`).
- **Server rendering**: a `ServerRenderer` / `ServerRenderedStory` export, plus
  `googleWebStoryUrl` — they generate Google Web Stories for SEO [verified].

## 4. Technical architecture [verified]

- Backend: `https://api.usestoryteller.com/api/app/{endpoint}`
  (plus `dev.` and `staging.` hosts), auth via **`x-storyteller-api-key`**.
- Observed endpoints: `story/stories`, `story/stories/default`, `story/stories/externalId`,
  `story/stories/pages`, `clips/externalId`, `ads/stories`, `ads/clips`,
  `settings/settings/default`, `activity/recordActivity`.
- Web **Stories** are rendered via Google's **`amp-story-player`** — they did not build a
  story renderer, they wrapped AMP's.
- Web **Clips** play over **HLS**.
- Client SDKs: iOS (SwiftPM + CocoaPods), Android, React Native, Web/JS.
- Optional native modules: **Lottie**, **GAM**, **VAST**, and a **Brightcove collector**
  (pulls video out of Brightcove into Storyteller) — so if our video lives in Brightcove,
  there is an off-the-shelf ingestion path.

## 5. Two facts that matter most for us

1. **YinzCam has already integrated this.** The official Storyteller Android sample app
   lives under the **`yinzcam-android`** GitHub org. Our app (`com.yinzcam.nfl.texans`) is a
   YinzCam build. That removes most of the "will our app vendor support it" risk.
2. **There is a documented Integrations API** — `docs.integrations.usestoryteller.com` —
   whose stated purpose is to let an integrator *push* images and videos into Storyteller to
   be published as Stories or Clips [reported]. **That is the seam we want.** It means we can
   own the hard part (social ingestion, rights clearance, editorial rules) and let Storyteller
   own the players, CMS chrome, ads and analytics — and keep the option to swap them out.

## 6. Social import — what they claim vs what's knowable

Storyteller markets "import your content directly from Social Media, so you can bring the
best of your social to your app and website" [reported]. Nothing in the shipped SDK exposes
how that works — it's a CMS-side feature, so it's not inspectable from the client.

**Treat this as the single most important thing to interrogate on a sales call**, because
[doc 02](02-social-ingestion-constraints.md) shows that a genuinely automatic
TikTok/YouTube video import is not legally or technically possible. Whatever their importer
does, it is almost certainly one of: (a) Instagram-only, (b) a manual download-and-reupload
assist, or (c) metadata-only with an embed. Ask them to demo it live against a TikTok
account before believing it.

## 7. Pricing [reported]

Published tiers run roughly $0 → $999/mo (Startup ~100k MAU mobile / 500k web pageviews;
Growth ~500k / 1m; Pro ~1m / 2m), 15% off annual, **enterprise is bespoke**. At NFL-club
scale we are an enterprise conversation, not a self-serve tier. The LA Rams case study is
the closest public reference: Stories reportedly drove 35% of app content views during the
2024 NFL Draft, total content views +160% YoY, average session duration doubled, returning
visitors +21% [reported — vendor-supplied numbers, treat accordingly].
