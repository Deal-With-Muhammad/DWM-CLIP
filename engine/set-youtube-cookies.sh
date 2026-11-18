#!/bin/sh
# Signs the clip engine in to YouTube, so it can fetch age-restricted videos and is asked to
# "confirm you're not a bot" far less often.
#
#   1. In a browser, sign in to YouTube with a spare Google account (not your main one: YouTube can
#      restrict an account that is used from a server). Confirm its age if YouTube asks.
#   2. Export that browser's cookies for youtube.com as a "cookies.txt" (Netscape format) file, with
#      an extension such as "Get cookies.txt LOCALLY".
#   3. Run:  ./set-youtube-cookies.sh ~/Downloads/cookies.txt
#
# Only the youtube.com lines are kept. They are packed and stored as the secret YT_COOKIES on the
# engine's Worker; nothing is written into this folder. Cookies stop working after some weeks or when
# that account signs out: run this again with a fresh file when age-restricted videos start failing.
[ -f "$1" ] || { echo "Give the path of the cookies.txt file, for example: $0 ~/Downloads/cookies.txt"; exit 1; }
lines=$(grep -cE "^(#HttpOnly_)?\.?(www\.)?youtube\.com" "$1")
[ "$lines" -gt 3 ] || { echo "That file has no youtube.com cookies in it. Export it while signed in to YouTube."; exit 1; }
packed=$( { echo "# Netscape HTTP Cookie File"; grep -E "^(#HttpOnly_)?\.?(www\.)?youtube\.com" "$1"; } | gzip -9 | base64 -w0 )
echo "Keeping $lines YouTube cookies (${#packed} characters packed)."
[ "${#packed}" -lt 5000 ] || { echo "That is too big for one secret (5,000 characters). Export only youtube.com cookies."; exit 1; }
cd "$(dirname "$0")/cloudflare" || exit 1
printf '%s' "$packed" | npx wrangler secret put YT_COOKIES
