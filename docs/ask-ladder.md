# The ask ladder: how the feed learns about a fan

Written 2 Nov 2026 after Adam's first night on the live feed: "it took a LOT of answers to get
to the button", and "what we have is not a bad product but it is not optimised towards the
objective". This is the redesign of how the feed asks, what the best consumer products do, what
changed the same night, and what comes next. The objective it serves is in CLAUDE.md: know our
fans better than any other organisation.

## What the best products do, and what we take from each

| Pattern | Who | What the evidence says | What we take |
|---|---|---|---|
| Learn before asking | TikTok | The For You feed starts from implicit behaviour, above all watch time and skips, with no follow step at all ([ICWSM paper](https://ojs.aaai.org/index.php/ICWSM/article/view/42688), [summary](https://www.firstpagedigital.sg/resources/social/tiktok-fyp-algorithm/)) | The implicit profile already ranks after six card events. Per-player completion, not just views, is the next signal (proposal 1 of the daily review). The picker is an accelerator, never a gate. |
| One pick, instant payoff | Spotify | Onboarding asks for artists so the feed is relevant from the first screen; complexity is revealed only when needed ([teardown](https://app.uxcel.com/showcase/spotifys-new-user-onboarding-feature-product-teardown-222), [ICML preference elicitation](https://icml.cc/virtual/2023/29091)) | First-time picker now asks one question, "who do you want more of?", with the button in view. Everything else sits behind More options. |
| Delay the account ask until after value | Duolingo | Moving sign-up back a few steps raised daily actives about 20%; skippable "soft walls" plus one later hard wall added a further 8.2% ([First Round](https://review.firstround.com/the-tenets-of-a-b-testing-from-duolingos-master-growth-hacker), [Taplytics](https://taplytics.com/blog/duolingo-ab-test-onboarding)) | The identity ask is shown only to fans who have set their feed and felt it move (capture card audience "prefs"). It is always skippable. |
| Progressive profiling, one or two questions at the moment of relevance | Practitioner consensus | Keep early asks to one or two questions; ask later ones when the user already has something to lose; use every answer immediately ([UserGuiding](https://userguiding.com/blog/progressive-profiling), [Formbricks](https://formbricks.com/blog/user-onboarding-best-practices)) | Follow-up questions (More of?, Going to a game?, How do you watch?) are now their own one-tap cards, one per visit, only for fans with a feed, only for what they have not answered. Every tap changes the feed on the spot and says why. |
| One-tap identity | Google One Tap | Reddit saw conversion nearly double; Pinterest users were twice as likely to use One Tap as multi-step sign-in ([Google case studies](https://developers.google.com/identity/sign-in/case-studies), [Stytch](https://stytch.com/blog/improving-conversion-with-google-one-tap/)) | The identity ask should be one tap, not a form. See the architecture below. |
| Declared versus inferred, under the fan's control | Claude | What a person declares (profile, instructions) is kept apart from what the product infers (memory), and the person can see and change both ([AI UX teardown](https://aiuxplayground.com/teardowns/claude/personalization)) | The feed already separates picks (declared) from the profile (inferred) and labels each on the card. The "Your feed" chip is where the fan sees and edits what they declared. The inferred side needs its own view: "what the feed thinks you like" with a way to say no. Next. |
| Value exchange, not a form | Sports clubs | Preference centres that build gradually, and campaigns where registering unlocks something, outperform a sign-up form; one club credits campaign-acquired fans with about a fifth of first-season ticket sales (vendor figure) ([Dizplai](https://dizplai.com/our-thinking/12-ways-to-turn-anonymous-fans-into-first-party-data/), [WSC Sports](https://wsc-sports.com/blog/industry-insights/zero-first-party-data-the-new-mvps-of-fan-engagement/)) | The contest (signed photo of the fan's own player) and the offer cards are the exchange. The identity pitch is "your feed follows you everywhere", never a newsletter. |

## The ladder, as it stands tonight

Each rung is one tap, changes the feed immediately, and says why on the card it moved. A fan can
stop on any rung and still has a better feed than before.

| Rung | Trigger | Ask | Payoff the fan sees |
|---|---|---|---|
| 0 | Any view | Nothing. Watch time, completion, skips | After six card events the order is theirs, labelled "because you watch" when the knob allows |
| 1 | A like | Nothing. The like is the signal | That player's unseen cards move up at once, "Because you liked", with one tap to make it a pick |
| 2 | Card 3 (card 2 in the running experiment) | One question: who do you want more of? | Feed reorders on the spot, toast says what came first, reasons on every moved card |
| 3 | Later visits, one per visit, card 7 | More of? Going to a game? How do you watch? | Each answer moves the feed and says so |
| 4 | A live offer, the weekly card, a lapsed boost | Yes or no | A time-boxed lift with a date; a weekly mirror; the loop closed |
| 5 | A fan with a feed, after rungs 2 to 4 | Keep this feed everywhere (identity) | Their picks follow them across devices and channels. The NFL privacy block is shown at the moment of collection |

## Identity: how one-tap sign-in would work, and where it has to live

The feed is a cross-origin iframe on houstontexans.com. That decides the architecture.

- **Google.** One Tap and the Sign in with Google button run on FedCM. In a cross-origin iframe
  they work only if every parent frame carries `allow="identity-credentials-get"`, and Google's
  Intermediate Iframe API exists for exactly this embed case ([Google](https://developers.google.com/identity/gsi/web/guides/fedcm-migration), [iframe guide](https://developers.google.com/identity/gsi/web/amp/intermediate-iframe)). Google returns a signed ID token with the verified email; our Worker verifies it against Google's keys, then posts the email, name and the fan's pocket id to the Eloqua form server-side so Eloqua stays the system of record.
- **Apple.** Sign in with Apple JS does not reliably work inside a cross-origin iframe: the popup is blocked on desktop Safari and the response never reaches a frame whose origin differs from the registered redirect URI ([Apple developer forum](https://developer.apple.com/forums/thread/785385), [React wrapper note](https://github.com/a-tokyo/react-apple-signin-auth)). Apple has to run on the top-level page.
- **Meta.** Facebook Login grants `email` and `public_profile` without app review, and must be launched from a click because it opens a popup ([Meta docs](https://developers.facebook.com/docs/facebook-login/web), [FB.login](https://developers.facebook.com/docs/reference/javascript/FB.login)). Iframe behaviour is undocumented; treat it like Apple and run it on the host page.

**So the identity step belongs on houstontexans.com, not inside the feed.** The feed shows the
pitch card; the tap opens the club's own sign-in on the page (Google One Tap, Apple, Facebook,
or the NFL account the site already offers), and the host hands the result back through the
handshake the feed already has, the same channel that carries the pocket id today. The feed
never holds a token. Eloqua receives the email through the form endpoint with the NFL block
shown at the moment of collection, which is the rule Adam set.

**Zero taps first.** The site's own click tracker already records an Eloqua visitor GUID and an
NFL device id beside the pocket session id. For a fan who has ever clicked a club email, the
Eloqua GUID already resolves to a contact. If the handshake also passes those two ids, a share
of fans are recognised without being asked anything, and the ask ladder only has to reach the
rest. This is the highest-leverage identity change available and needs no new permission from
a fan; it needs a privacy read on using an id Eloqua already holds.

**Check the pocket id is persistent.** Adam's own browser produced two different `sess_` ids on
two days. If the host's pocket session id rotates per session, the "returning fan" layer is
weaker than designed and the NFL device id should become the primary key the handshake sends.

## What changed the same night

- First-time picker: one question, the button in view, the rest behind More options.
- Follow-up questions as one-tap cards on later visits, one per visit, only for what is unanswered.
- A like lifts that player's unseen cards and offers one tap to make it a pick; look-alike titles never lifted or served back to back.
- Offer cards show the three clips they would lift and the count.
- Brand faces on every system card.

## What to re-examine in how this was built

1. **Shipping proposals whole.** Six approved ideas went live as one picker. The right unit is the smallest version of one idea, measured, then widened. The ask ladder is that discipline written down.
2. **Tests prove intent, not experience.** Every suite passed while the picker needed scrolling. Each deploy now gets a first-fan walkthrough: the first seven cards as a new fan and as a returning fan, on a phone-sized viewport, looked at, not asserted.
3. **My own traffic in the fan numbers.** The first review counted verification runs as fan sessions. Verification loads now carry `?qa=1`, every event from them is marked, and the agents exclude them.
4. **Instrumentation assumed.** No autoplay event had ever been recorded and nobody noticed until the first review. Day one of any new signal gets a "has it fired once in production" check.
5. **Primitives assumed.** The pocket id was treated as a persistent identity; the catalogue as free of duplicate titles; an offer as fulfillable. Each was wrong somewhere. New primitives get a data check before anything is built on them.
6. **Pace.** Nine deploys in one night outran observation. Fixes ship any time; new asks ship after a day of watching the last one.
