# The roster placement

The feed on the roster page and on every player's page, as a row of tiles the width of the slot.
Same Worker, same cards, same events, one query parameter.

## Where it goes

Between the hero banner and the **Active** table, full content width. That band is empty today
and the hero above it is already dark, so the feed's steel background reads as part of the hero
rather than a hole in a white page.

| Slot | Height | What the fan sees |
|---|---|---|
| Roster, desktop (content column about 1240px) | 560px | About four and a half 9:16 tiles across, the chip bar above them |
| Roster, phone | 420px | Two tiles and the edge of a third, swipe for more |
| Player page, either | same | That player's clips first, each tile labelled with the name |

One iframe serves both sizes if the height is set with CSS:
`height: clamp(420px, 42vw, 600px)`.

## Try it on /news first

A lower-stakes slot to prove the rail on the live site before the roster: the top of the news
index, full content width, 420px tall so it reads as a strip above the stories rather than a
takeover. Every event from it says `feed_placement: news`, so the daily review can compare it
with /feed from day one.

```html
<iframe src="https://feed.htow.nz/?layout=rail&placement=news" title="Texans clips" width="100%" height="420" style="border:0;display:block;background:#021018" loading="lazy" allow="autoplay; fullscreen; clipboard-write"></iframe>
```

Add the handshake script from [`txfeed-handshake.html`](txfeed-handshake.html) once on the page
so fans are recognised there too. What to check once it is placed, in this order:

1. The strip renders the tiles, not a loading message, on desktop and on a phone.
2. A tile opens the feed full-frame inside the strip and the close button returns.
3. In the events table, `feed_load` rows carry `feed_placement = news` and, for a signed-in
   browser, a `sess_` id rather than a `dv-` id (the handshake worked).
4. The news stories inside the rail are the site's own and open their pages in a new tab.

Taller works too: at 560px the strip shows the same tiles larger. 420px is the recommendation
for a first test above a list of stories.

## The roster page

```html
<iframe src="https://feed.htow.nz/?layout=rail&placement=roster" title="Texans clips" width="100%" height="560" style="border:0;display:block;background:#021118" loading="lazy" allow="autoplay; fullscreen; clipboard-write"></iframe>
```

Add the handshake script from [`txfeed-handshake.html`](txfeed-handshake.html) once on the
page, as on `/feed`, so the fan's pocket id reaches the feed and their picks follow them here.

## A player's page

The same iframe with `placement=player` and `focus=<slug>`. The slug is the player's dictionary
slug, which matches the site's URL slug (`will-anderson-jr`, `c-j-stroud`). A slug the dictionary
does not know, or an excluded name, is ignored and the shared order is served; nothing breaks.

```html
<iframe id="txfeed-player" title="Texans clips" width="100%" height="560" style="border:0;display:block;background:#021118" loading="lazy" allow="autoplay; fullscreen; clipboard-write"></iframe>
<script>
(function () {
  var m = location.pathname.match(/\/players-roster\/([a-z0-9-]+)/);
  var f = document.getElementById('txfeed-player');
  f.src = 'https://feed.htow.nz/?layout=rail&placement=player' + (m ? '&focus=' + m[1] : '');
}());
</script>
```

If the CMS can write the slug into the page template, skip the script and put it on the `src`.

## What the fan gets

- **Tiles in the fan's order.** Picks, lanes, follows and boosts rank the rail exactly as they
  rank the feed, with the reason on the tile.
- **The player's page is the first pick.** `focus` lifts that player's cards above everything,
  including the fan's own picks and history, labelled with the name. Their cards run back to
  back here; the variety rule stands aside for them.
- **One tap into the feed.** A tile opens the full feed at that card, with the chip bar, sound,
  like, share and the picker. Close returns to the tiles on the card that was open.
- **The picker starts from the page.** Open the picker on Will Anderson Jr.'s page and he is
  already pressed. Save, and he follows the fan to every placement.

## What we learn

Every `feed_load` now carries:

| Param | Values |
|---|---|
| `feed_layout` | `feed` or `rail` |
| `feed_placement` | whatever the iframe said: `roster`, `player`, later `schedule` |
| `feed_focus` | the player slug on a player page, only when it applied |
| `feed_rank` | `shared`, `implicit`, `personal`, or `focused` when only the page ranked it |
| `visit_n`, `returning`, `days_since` | this device's visit count, whether it has been here before, days since the last visit |

A visit is a load more than 30 minutes after the last one on that device, kept under the same
consent as the device id: a visitor who declined measurement gets no counter. `rail_open` and
`rail_close` record which tile was tapped and at which position; the card events then flow
exactly as in the feed, so a rail session slices like a feed session.

## Returning fans, in full

Three layers answer "have we seen this fan before", from strongest to weakest:

1. **The pocket id**, handed over by the site. It lives in the site's own storage, so a fan who
   returns in the same browser is the same `session_id` in `feed_events`, `feed_profiles`
   (`first_seen`, `last_seen`, `events`) and `feed_preferences`. Their picks and reasons are
   waiting from the first card.
2. **The device id**, minted by the feed when the site has not answered. Same idea, scoped to
   the feed's origin.
3. **The visit counter** above, which says how many times and how recently, without a lookup.

A fan who clears storage, changes browser or device is new to all three until they identify
themselves through the entry form, which carries the pocket id so the join can be made later.

## The ticket pages (approved 14 Nov 2026)

The same rail as the news page, with its own placement name so the review can read ticket
sessions on their own and join them to the ticket clicks in D1. Paste where the page has a
full-width band, above the fold if the page allows it:

```html
<iframe src="https://feed.htow.nz/?layout=rail&placement=tickets" title="Texans clips" width="100%" height="420" style="border:0;display:block;background:#021018" loading="lazy" allow="autoplay; fullscreen; clipboard-write"></iframe>
```

Nothing else changes: the handshake on the page hands the rail the pocket id as on every other
page, and every event from it carries `feed_placement: tickets`. The review reports it as its
own row from the first load, and the D1 join (click sessions that also opened the feed) is the
number to watch.
