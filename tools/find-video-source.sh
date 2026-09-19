#!/usr/bin/env bash
# Works out how a houstontexans.com video page actually serves its video.
#
# The question it answers: is presser video addressable as a Cloudinary asset? If yes,
# clipping works today against assets that already exist — no upload workflow, no new
# storage, nothing to procure. See docs/research/13-the-supply-picture.md.
#
#   ./find-video-source.sh
#   ./find-video-source.sh "https://www.houstontexans.com/video/some-other-video"
#
# Read-only: fetches one public page and greps it. Paste the whole output back.

set -uo pipefail
URL="${1:-https://www.houstontexans.com/video/houston-texans-coordinators-address-the-media-full-q-a}"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'

hr(){ printf '\n%s\n' "──────────────────────────────────────────────────────────────"; }
echo "fetching  $URL"
PAGE="$(curl -sS -m 60 -L -A "$UA" "$URL" 2>/dev/null)"
if [ -z "$PAGE" ]; then echo "FAILED — empty response"; exit 1; fi
echo "bytes     ${#PAGE}"

hr; echo "1. CLOUDINARY VIDEO REFERENCES   <- the one that matters"
printf '%s' "$PAGE" \
  | grep -oE '(https?:)?//[a-z0-9.-]*(cloudinary|clubs\.nfl)[a-z0-9.-]*/[a-z]+/upload/[^"'"'"' \\)]*' \
  | sort -u | head -20 | sed 's/^/  /'
printf '%s' "$PAGE" | grep -qE 'video/upload' \
  && echo "  >> /video/upload/ IS present — clipping works against existing assets" \
  || echo "  >> no /video/upload/ found in the HTML"

hr; echo "2. STREAM MANIFESTS"
printf '%s' "$PAGE" | grep -oE 'https?://[^"'"'"' \\)]+\.(m3u8|mpd)[^"'"'"' \\)]*' \
  | sort -u | head -10 | sed 's/^/  /'
printf '%s' "$PAGE" | grep -qE '\.(m3u8|mpd)' || echo "  (none in initial HTML — the player likely fetches it at runtime)"

hr; echo "3. PROGRESSIVE FILES"
printf '%s' "$PAGE" | grep -oE 'https?://[^"'"'"' \\)]+\.mp4[^"'"'"' \\)]*' | sort -u | head -8 | sed 's/^/  /'

hr; echo "4. ASSET / VIDEO IDENTIFIERS"
for k in publicId public_id cloudinaryId videoId assetId mediaId externalId brightcoveId accountId; do
  printf '%s' "$PAGE" | grep -oE "\"$k\"[[:space:]]*:[[:space:]]*\"[^\"]{4,80}\"" \
    | sort -u | head -3 | sed 's/^/  /'
done

hr; echo "5. PLATFORM FINGERPRINTS"
for k in cloudinary clubs.nfl.com brightcove jwplayer mux vimeo kaltura akamaized theoplayer videojs bitmovin hls.js dash.js deltatre forge; do
  n=$(printf '%s' "$PAGE" | grep -oi -- "$k" 2>/dev/null | wc -l | tr -d ' ')
  [ "${n:-0}" -gt 0 ] 2>/dev/null && printf '  %-16s %s\n' "$k" "$n"
done

hr; echo "6. EMBEDDED JSON BLOBS (keys only)"
printf '%s' "$PAGE" | grep -oE '<script[^>]*type="application/(ld\+)?json"[^>]*>' | head -5 | sed 's/^/  /'
printf '%s' "$PAGE" | grep -oE '"(contentUrl|embedUrl|thumbnailUrl|duration)"[[:space:]]*:[[:space:]]*"[^"]{4,140}"' \
  | sort -u | head -8 | sed 's/^/  /'

hr; echo "Done. Paste everything above."
echo "If section 1 shows a /video/upload/ URL, send me that whole URL — it unblocks the clipping build."
