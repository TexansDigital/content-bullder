#!/usr/bin/env bash
# Pulls the video-config JSON out of a houstontexans.com video page and prints it.
#
# The previous pass found no /video/upload/, so Cloudinary serves the poster but not the
# video. It did find `mux` twice and a <script type="application/json" id="video-config-…">
# blob. That blob names the real video platform and the playback identifier — which decides
# whether clipping runs against Cloudinary, against Mux, or against something else.
#
#   ./extract-video-config.sh
#   ./extract-video-config.sh "https://www.houstontexans.com/video/<slug>"
#
# Read-only: one GET against a public page. Paste the whole output back.

set -uo pipefail
URL="${1:-https://www.houstontexans.com/video/houston-texans-coordinators-address-the-media-full-q-a}"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'

echo "fetching  $URL"
curl -sS -m 60 -L -A "$UA" "$URL" > /tmp/txpage.html 2>/dev/null
echo "bytes     $(wc -c < /tmp/txpage.html | tr -d ' ')"

python3 - "$URL" <<'PY'
import re, sys, json, html

raw = open('/tmp/txpage.html', encoding='utf-8', errors='replace').read()

def hr(t): print('\n' + '─'*62 + f'\n{t}')

hr('1. video-config BLOBS')
blobs = re.findall(
    r'<script[^>]*type="application/json"[^>]*id="(video-config[^"]*)"[^>]*>(.*?)</script>',
    raw, re.S)
if not blobs:
    print('  none found')
for name, body in blobs[:2]:
    print(f'  id: {name}')
    try:
        data = json.loads(html.unescape(body.strip()))
        print(json.dumps(data, indent=2)[:3500])
    except Exception as e:
        print(f'  (not parseable: {e})')
        print('  ' + body.strip()[:1200])

hr('2. MUX CONTEXT  (what surrounds each mention)')
for m in re.finditer(r'.{110}mux.{110}', raw, re.I | re.S):
    print('  …' + re.sub(r'\s+', ' ', m.group(0)) + '…\n')

hr('3. PLAYBACK-ID SHAPED VALUES')
pats = {
    'mux playback id': r'"(?:playbackId|playback_id)"\s*:\s*"([A-Za-z0-9]{20,})"',
    'stream.mux.com':  r'https?://stream\.mux\.com/[^"\'\\ ]+',
    'image.mux.com':   r'https?://image\.mux\.com/[^"\'\\ ]+',
    'any m3u8':        r'https?://[^"\'\\ ]+\.m3u8[^"\'\\ ]*',
    'mediaId/uuid':    r'"(?:mediaId|videoId|assetId|id)"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"',
}
for label, pat in pats.items():
    hits = sorted(set(re.findall(pat, raw)))[:5]
    print(f'  {label:18} {hits if hits else "—"}')

hr('4. ld+json VIDEO OBJECT')
for m in re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', raw, re.S):
    try:
        d = json.loads(html.unescape(m.group(1).strip()))
    except Exception:
        continue
    for node in (d if isinstance(d, list) else [d]):
        if isinstance(node, dict) and 'Video' in str(node.get('@type', '')):
            print(json.dumps(node, indent=2)[:1400])

hr('5. ANY OTHER application/json SCRIPT IDS')
for i in sorted(set(re.findall(r'<script[^>]*type="application/json"[^>]*id="([^"]+)"', raw)))[:20]:
    print('  ' + i)

print('\n' + '─'*62)
print('Done. Paste everything above.')
PY
