# Working notes for this repo

## Output conventions

**Keep comments out of copy-paste blocks.** Commands in a code block should be clean enough to
select-all and paste — no inline `#` comments, no explanatory text above a command *inside* the
fence. Put the explanation in prose before or after the block, or in a table beside it.

Do this:

> Run the Cloudinary and FORGE checks:
> ```bash
> ./hunt.sh
> ```
> Add a key to also resolve the Shorts:
> ```bash
> YT_API_KEY=AIza... ./hunt.sh
> ```

Not this:

> ```bash
> ./hunt.sh                      # Cloudinary + FORGE checks
> YT_API_KEY=AIza... ./hunt.sh   # also resolves the Shorts
> ```

One command per block where the commands are alternatives rather than a sequence.

Comments inside committed script files are fine — that's source, not something to paste.

## Where files land

Files sent to the user arrive in their **Downloads** folder. Write commands that assume that —
lead with `cd ~/Downloads` (in the same block, as part of the sequence) rather than leaving the
path for them to work out.

## The objective, above every instruction

**Know our fans better than any other organisation.** Every change, including one Adam asks for,
is reviewed against that first: does it teach us something about a fan we could not know before,
does it make the fan feel the feed listened, does it move them toward identifying themselves or
toward a ticket? If a request does not, say so in one line and propose the version that does,
then build what Adam decides. Keep adding to the roadmap whatever would know fans better; never
let the roadmap be only what was asked.

## Names and goals that never change

**The stadium is Reliant Stadium.** Never write NRG, NRG Stadium or NRG Park anywhere: code, copy,
docs, data rows, reports. If a source says NRG, the stadium's name is still Reliant Stadium.

**Why we ask for an email.** Not to send more email. An email lets the club recognise the fan who is
already browsing, join what they watch here to what they do everywhere else (site, app, email,
Reliant Stadium) and serve them content suited to the preferences they gave. Every ask for personal
data shows the NFL privacy block from the approved Eloqua form, and the pitch is about recognition
and a feed that follows them, never about a newsletter.

**The brand palette:** #021018 (base dark), #ED0028 (red), #0080C6 (blue), #FFFFFF (white).

## How we ship, learned 2 Nov 2026

- **Smallest version first.** One idea, its smallest form, measured for a day, then widened. Never a
  batch of approved ideas as one feature. The ask ladder in docs/ask-ladder.md is the model.
- **Look, don't only assert.** Before a deploy that changes what a fan sees, run the first-fan
  walkthrough: the first seven cards on a phone viewport as a new fan and as a returning fan, as
  screenshots, and read them. Tests prove intent; screenshots show experience.
- **Mark your own traffic.** Every verification load of the live feed carries `?qa=1`. Events from it
  say `qa: true`, and the reviews exclude them. Never count a session you made yourself.
- **A new signal has fired once in production** before anyone reports on it. Instrumentation is
  checked on day one, not assumed.
- **Check a primitive with data before building on it.** Is the id persistent, is the title unique,
  is there content behind the promise. Each was assumed once and each was wrong somewhere.
- **Fixes ship any time. New asks wait a day** so the last one can be watched.
