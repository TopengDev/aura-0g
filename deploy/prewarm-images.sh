#!/usr/bin/env bash
# Pre-warm the AURA image transcode cache so the FIRST visitor (the jury) never pays the cold AVIF-encode
# penalty. The /images route encodes to AVIF/WebP on a cache MISS, which costs 1-6s per image on the VPS;
# this script forces every gallery image to be encoded ONCE (into the persistent L2 disk cache) right
# after a deploy, so every real visit is a warm ~tens-of-ms read.
#
# It works by SCRAPING the actual image URLs the live pages emit (so it auto-warms exactly the widths the
# frontend requests), then requesting each as both AVIF and WebP. It also warms the width-less (full-res)
# variant of each, which is what the per-item DETAIL pages request.
#
# Usage:  deploy/prewarm-images.sh [BASE_URL] [CONCURRENCY]
#   BASE_URL     default https://aura.topengdev.com
#   CONCURRENCY  default 2  (keep LOW -- concurrent AVIF encodes thrash the 4-vCPU box)
#
# Safe + idempotent: it only GETs images; re-running is a no-op once the cache is warm. Run it AFTER the
# new web image is live (the scrape must see the new ?w URLs).
set -uo pipefail

BASE="${1:-https://aura.topengdev.com}"
CONC="${2:-2}"
PAGES=("/" "/agents" "/explore")

echo "[prewarm] base=$BASE concurrency=$CONC"

tmp_urls="$(mktemp)"
trap 'rm -f "$tmp_urls"' EXIT

# 1. Collect every /images/... URL from the gallery pages. The HTML encodes "&" as "&amp;", so decode it
#    back to "&" -- otherwise "?style=x&amp;w=700" parses as a param named "amp;w" and the real "w=700"
#    variant (what the browser actually requests) is never warmed.
for p in "${PAGES[@]}"; do
  curl -s --max-time 30 "$BASE$p" \
    | grep -oE '/images/[^"'"'"' \\<>]+' \
    | sed 's/&amp;/\&/g' \
    >> "$tmp_urls" || true
done

# 2. Add the width-less (full-res) variant of each (the detail views request these), then dedupe.
#    (strip a trailing ?... or &w=.. -> the bare root+style)
awk '{print} { u=$0; sub(/\?.*/,"",u); print u }' "$tmp_urls" \
  | sed 's#\\$##' \
  | sort -u > "${tmp_urls}.uniq"
mv "${tmp_urls}.uniq" "$tmp_urls"

count="$(wc -l < "$tmp_urls" | tr -d ' ')"
echo "[prewarm] $count unique image URLs to warm (x2 formats: avif + webp)"

# 3. Warm each as AVIF and WebP, at low concurrency. Print a terse per-request line.
warm_one() {
  local url="$1" fmt="$2" accept
  case "$fmt" in
    avif) accept="image/avif,image/webp,*/*" ;;
    webp) accept="image/webp,*/*" ;;
  esac
  curl -s -o /dev/null --max-time 60 -H "Accept: $accept" \
    -w "[prewarm] %{http_code} %{time_total}s $fmt ${url}\n" "${BASE}${url}"
}
export -f warm_one
export BASE

# avif first (the dominant client format), then webp.
for fmt in avif webp; do
  # shellcheck disable=SC2016
  xargs -P "$CONC" -I{} bash -c 'warm_one "$@"' _ {} "$fmt" < "$tmp_urls"
done

echo "[prewarm] done."
