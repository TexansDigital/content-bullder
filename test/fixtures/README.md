# Fixtures

`bars-30s.webm` — a 30-second 180x320 VP8 clip where second *i* is a flat
`rgb(i*8, 255-i*8, 128)` with the number *i* drawn on it, keyframed once a second.

Because the colour encodes the timestamp, a test can sample one pixel off a
`<video>` and know which second is on screen. That is how `verify-playback-clip.mjs`
proves the feed actually seeks to a clip's in-point, rather than only that
`currentTime` was assigned.
