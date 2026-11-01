# Debug journal

The daily debug agent's memory. It reads this file before every run and appends to it after.
Three sections, in this order: the method (which the agent is allowed to improve), the ledger of
findings (so a later run can mark what was confirmed, fixed or a false alarm), and the run log.
Keep entries short. Dates are UTC.

## Method (current)

A pass is the same every day so results are comparable. Change the method only in the
"Method changes" step at the end of a run, and say why.

1. Read the last three run entries and the open ledger items first.
2. Run every suite that needs no browser: `node test/verify-rank.mjs`, `verify-worker`,
   `verify-catalogue`, `node --check` on every `.mjs`/`.js` under `src/`, `workers/`, `server.mjs`.
3. Start `node server.mjs` on 4400 with `STORE` pointing at a scratch file and run the browser
   suites in this order: verify-feed, verify-events, verify-identity, verify-ux, verify-play,
   verify-hardening, verify-analytics-order, verify-fixes, verify-clip, verify-playback-clip,
   verify-prefs. Clear the store between suites that assume one (fixes, clip).
4. Diff review: `git log --since="36 hours ago" -p -- app src workers server.mjs sql` and read
   every hunk adversarially: what input breaks it, what happens when Supabase is down, what a
   hostile host page or a malformed event could do, what changes on a 390px phone frame.
5. Static sweeps (grep, not guesswork): `innerHTML` with interpolated values that skip `esc()`;
   `href`/`src` built from data without `safeUrl()`; `JSON.parse` without try; promises without
   catch in `app/feed.html`; `await` inside `forEach`; new `fetch` calls without a timeout or
   failure path; SQL functions in `sql/` that differ from what `sql/README.md` says is applied.
6. Production check, read-only: `https://feed.htow.nz/health`, `/api/feed` (clip count, warnings,
   knobs), `/feed` renders the current commit (grep a marker from the latest change).
7. Rank what you found by blast radius × likelihood. Verify each candidate with a reproduction
   (a test, a curl, a Playwright snippet) before it goes in the ledger as CONFIRMED; otherwise
   it is SUSPECTED.
8. Research: one or two searches on a debugging method relevant to today's findings (or, if
   none, on a class of defect this codebase could have: iframe/IntersectionObserver, postMessage
   origin handling, Cloudflare Worker caching, PostgREST upserts). Record one concrete change
   to this method, or "no change", with the source.

Precision matters more than volume. A false alarm costs the team a morning. Track it.

## Ledger

| id | opened | status | where | summary | evidence | closed |
|---|---|---|---|---|---|---|

Statuses: SUSPECTED, CONFIRMED, FIXED (commit), FALSE-ALARM (why), WONTFIX (who decided).

## Precision

| run | findings | confirmed | false alarms | later confirmed by others |
|---|---|---|---|---|

## Runs

(The agent appends one entry per run: date, suites run and results, findings opened or
closed, method changes with source, time spent.)
