# 15 — Transcript-first clipping

Two facts landed together:

1. **Pressers carry no burned-in captions.** So the 2% caption coverage
   ([doc 13 §5](13-the-supply-picture.md)) is a real accessibility gap, not a cosmetic one.
2. **Someone already sits through the pressers.**

They have the same solution, and the second fact changes how the tool should work.

## 1. One capability solves both problems

Transcribe each presser once and you get:

- **Caption tracks** — closes the accessibility gap, for the presser *and* for every clip cut
  from it, because word-level timestamps slice with the clip.
- **A text interface for clipping** — which is a far better interface than a video scrubber.

That's a single capability paying for itself twice. It also reframes the captions question from
"an accessibility cost we should probably absorb" into "the thing that makes the clipping tool
fast." Much easier to justify.

## 2. Don't build a scrubber. Build a highlighter.

The instinct — and what the current prototype demonstrates — is a timeline with in/out handles.
For a 20-minute talking-head presser that is the wrong instrument. Finding the good 20 seconds
means scrubbing back and forth listening for it.

With a word-timestamped transcript, the editor **reads** the presser, selects a passage, and the
in/out points come from the timestamps on the first and last word. Selecting text is faster than
scrubbing video, it's skimmable, it's searchable across every presser ever transcribed, and it
produces a headline for free — the selected sentence is usually the quote.

```
transcript  ──▶ editor selects "…we've got to finish drives…"
                     │
                     ├── word timestamps  → so_124.4, eo_146.1
                     ├── selected text    → clip headline + caption
                     └── sliced VTT       → the clip's own caption track
```

The timeline stays, but as a **confirmation** step — check the cut isn't mid-word, nudge a
second either way — not as the way you find the moment.

## 3. "We sit through the pressers" makes this nearly free

The expensive part of clipping is watching. That cost is already being paid.

So the tool shouldn't ask for a second pass. Two modes, both cheap:

- **During the watch** — a single "mark" key when something good happens. Drops a rough marker;
  refine later against the transcript. Marginal effort ≈ zero.
- **After the watch** — the transcript is ready by the time the presser ends; skim, highlight
  three passages, done. Minutes, not a work session.

Design target: **three clips from a presser in under two minutes**, by someone who already knows
what was said because they just heard it.

## 4. What this needs

| Need | Options |
| --- | --- |
| Word-level timestamps | Cloudinary's transcription add-on (if on the plan — unverified), or a Whisper-class worker. Whisper gives word-level timings natively; Cloudinary's granularity needs checking |
| Somewhere to run it | Transcription needs the audio file, which brings us back to [doc 14](14-where-presser-video-lives.md) — the master reaching a place we control |
| Storage | Transcripts are small. A JSON file per presser alongside the manifest is enough at this scale |

Note the dependency: **transcription needs the file too.** It doesn't avoid the master question,
it just adds a second strong reason to solve it — the same third upload destination gives us
clipping, captions, transcripts and search in one move.

## 5. Revised ask

The earlier question "who clips, and do they have ten minutes?" is answered: someone is already
in the room. The better questions now:

1. **Who is it, and would they use a transcript?** Some people prefer scrubbing. Worth asking the
   person rather than assuming.
2. **How soon after a presser would clips need to be live?** Same day, or within the hour? That
   decides whether transcription can be a batch job or needs to be near-real-time.
3. **Does anyone already transcribe these** — for the website, for accessibility, for search? If
   a transcript already exists somewhere, most of this is already paid for.
