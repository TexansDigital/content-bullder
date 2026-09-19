#!/usr/bin/env bash
# Answers the open questions this environment can't reach.
# Read-only: every call is a GET against a public or key-authorised endpoint.
# Nothing is uploaded, written, or modified anywhere.
#
#   ./tools/hunt.sh                        # Cloudinary + FORGE checks
#   YT_API_KEY=AIza... ./tools/hunt.sh     # also resolves the ten Shorts
#
# Paste the whole output back.

set -uo pipefail
BASE="${CLD_BASE:-https://static.clubs.nfl.com}"
IMG_ID="${CLD_IMG_ID:-texans/bodufcw8x4wotk4q7ses}"
VID_ID="${CLD_VID_ID:-$IMG_ID}"
FORGE_URL="${FORGE_URL:-https://www.houstontexans.com/video/houston-texans-coordinators-address-the-media-full-q-a}"
SHORTS=(m6gOqjDBXxo 5f7d3ssRsvc B2O7lzt94ow PEsizG9Nw9c 1ofJgtx5kGs 3CCZORLOJvI JNTvbU4ntLA UKhZWYGTbYU y92971B7ihI CQX5rQBGzYo)

RAW_TILE='so_1.5,f_auto,q_auto,c_fill,g_auto,ar_4:5,w_400'
RAW_9x16='f_auto,q_auto,c_fill,g_auto,ar_9:16'
RAW_POST='so_1.5,f_auto,q_auto,c_fill,g_auto,ar_9:16,w_720'

hr(){ printf '\n%s\n' "────────────────────────────────────────────────────────────"; }
code(){ curl -sS -o /dev/null -m 25 -w '%{http_code}' -A 'texans-feed-probe' "$1" 2>/dev/null || echo "ERR"; }
chk(){ # label, url
  local c; c="$(code "$2")"
  case "$c" in 200|206) printf '  ✅ %-34s %s\n' "$1" "$c";;
               404)     printf '  ❌ %-34s %s (blocked or absent)\n' "$1" "$c";;
               *)       printf '  ⚠️  %-34s %s\n' "$1" "$c";; esac
}

echo "Texans feed — capability hunt   $(date -u +%FT%TZ)"
echo "base=$BASE  img=$IMG_ID  vid=$VID_ID"

hr; echo "1. CLOUDINARY — IMAGES"
chk "original, no transform"      "$BASE/image/upload/$IMG_ID.jpg"
chk "raw w_200"                   "$BASE/image/upload/w_200/$IMG_ID.jpg"
chk "raw 4:5 + g_auto"            "$BASE/image/upload/$RAW_TILE/$IMG_ID.jpg"
chk "named t_tx_feed_tile"        "$BASE/image/upload/t_tx_feed_tile/$IMG_ID.jpg"

hr; echo "2. CLOUDINARY — VIDEO  (does the resource type exist at all?)"
chk "video original .mp4"         "$BASE/video/upload/$VID_ID.mp4"
chk "video raw 9:16 + g_auto"     "$BASE/video/upload/$RAW_9x16/$VID_ID.mp4"
chk "video poster .jpg"           "$BASE/video/upload/$RAW_POST/$VID_ID.jpg"
chk "video HLS sp_auto .m3u8"     "$BASE/video/upload/$RAW_9x16/sp_auto/$VID_ID.m3u8"

hr; echo "2b. CLOUDINARY — WHY did video 404?  (X-Cld-Error is the real answer)"
for u in "$BASE/video/upload/$VID_ID.mp4" "$BASE/image/upload/$IMG_ID-definitely-not-real.jpg"; do
  echo "  $u"
  curl -sSI -m 25 "$u" 2>/dev/null | grep -iE '^(HTTP/|x-cld-error)' | sed 's/^/    /'
done
echo "  Compare the two: identical errors = the asset is just missing."
echo "  A different error on the video = the resource type itself is unavailable."

hr; echo "3. FORGE VIDEO PAGE — is a stream addressable?"
PAGE="$(curl -sS -m 40 -A 'Mozilla/5.0' -L "$FORGE_URL" 2>/dev/null)"
if [ -z "$PAGE" ]; then echo "  ⚠️  page fetch failed"; else
  echo "  bytes: ${#PAGE}"
  echo "  --- m3u8 / mpd references ---"
  printf '%s' "$PAGE" | grep -oE 'https?://[^"'"'"' \\]+\.(m3u8|mpd)[^"'"'"' \\]*' | sort -u | head -8 | sed 's/^/    /'
  [ -z "$(printf '%s' "$PAGE" | grep -oE '\.(m3u8|mpd)')" ] && echo "    (none in initial HTML — likely fetched by the player at runtime)"
  echo "  --- platform fingerprints ---"
  for k in brightcove jwplayer mux.com vimeo kaltura akamaized ooyala theoplayer videojs bitmovin dailymotion youtube deltatre forge; do
    n=$(printf '%s' "$PAGE" | grep -oic "$k" 2>/dev/null || echo 0)
    [ "$n" -gt 0 ] && printf '    %-14s %s\n' "$k" "$n"
  done
fi

hr; echo "4. YOUTUBE — the ten Shorts"
if [ -z "${YT_API_KEY:-}" ]; then
  echo "  SKIPPED — no YT_API_KEY in the environment."
  echo "  Re-run as:  YT_API_KEY=<your real key> ./hunt.sh"
  echo "  (a literal 'AIza...' with dots is not a key — paste the whole thing)"
else
  echo "  key present (${#YT_API_KEY} chars). Querying ${#SHORTS[@]} video ids…"
  IDS=$(IFS=,; echo "${SHORTS[*]}")
  R="$(curl -sS -m 40 "https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status,statistics&id=$IDS&key=$YT_API_KEY")"
  if printf '%s' "$R" | grep -q '"error"'; then
    echo "  ⚠️  API error:"; printf '%s' "$R" | head -c 700 | sed 's/^/    /'
  else
    printf '%s' "$R" | python3 -c '
import sys,json,re
d=json.load(sys.stdin)
def secs(s):
    m=re.match(r"PT(?:(\d+)M)?(?:(\d+)S)?",s or "")
    return int(m.group(1) or 0)*60+int(m.group(2) or 0) if m else 0
print("  %-13s %-6s %-6s %-9s %s"%("ID","DUR","EMBED","VIEWS","TITLE"))
for v in d.get("items",[]):
    s,c,st=v["snippet"],v["contentDetails"],v.get("status",{})
    n=secs(c.get("duration"))
    print("  %-13s %-6s %-6s %-9s %s"%(v["id"],f"{n//60}:{n%60:02d}",
        "yes" if st.get("embeddable") else "NO",
        v.get("statistics",{}).get("viewCount","-"), s["title"][:58]))
ch={v["snippet"]["channelId"] for v in d.get("items",[])}
print("\n  channelId:", ", ".join(ch) or "-")
print("  returned %d of 10"%len(d.get("items",[])))
'
    if [ $? -ne 0 ]; then
      echo "    (could not parse — raw response follows, paste it back as-is)"
      printf '%s' "$R" | head -c 4000
    fi
  fi
fi

hr; echo "Done. Paste everything above."
