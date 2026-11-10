#!/usr/bin/env bash
# Uptime watch for the Izin container (run from cron every 5 minutes).
#  1. Site: GET / and /api/health through the public URL. Two failures in a row = one "unhealthy" alert
#     (the text is lang/<alerts.language>.json alerts.unhealthy); recovery = one info line. At most one
#     alert of each kind per UTC day.
#  2. Relay: the server cannot reach the host's notifier from inside the container, so it logs alerts as
#     JSON lines {"alert": "...", "delivered": false}. Lines logged since the last run are sent on, each
#     distinct text at most once per UTC day.
# Host values come from deploy/hos.env (IZIN_DOMAIN, NOTIFY_CMD). State: deploy/.uptime-state (not tracked).
# Test overrides: UPTIME_URL, UPTIME_STATE, UPTIME_NOTIFY, UPTIME_NOW (epoch seconds), UPTIME_LANG.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -r "$ROOT/deploy/hos.env" ] && . "$ROOT/deploy/hos.env"
URL=${UPTIME_URL:-https://${IZIN_DOMAIN:-localhost}}
STATE=${UPTIME_STATE:-$ROOT/deploy/.uptime-state}
NOTIFY=${UPTIME_NOTIFY:-${NOTIFY_CMD:-}}
NOW=${UPTIME_NOW:-$(date +%s)}
LANG_FILE=${UPTIME_LANG:-$ROOT/lang/ms.json}
DAY=$(date -u -d "@$NOW" +%F)
UA="IzinBot/0.1 (+https://izin.sasateguh.com/bot) uptime"

# State: line 1 = "<up|down> <failures> <last run epoch>", then "sent <day> <md5 of text>" lines for today.
prev=up; fails=0; last=$((NOW - 300))
if [ -f "$STATE" ]; then read -r prev fails last < <(head -1 "$STATE"); fi
[[ "${fails:-}" =~ ^[0-9]+$ ]] || fails=0
[[ "${last:-}" =~ ^[0-9]+$ ]] || last=$((NOW - 300))
sent=$(grep "^sent $DAY " "$STATE" 2>/dev/null || true)

send() {  # $1 text, $2 level; once per text per UTC day
  local h; h=$(printf '%s' "$1" | md5sum | cut -c1-16)
  grep -q " $h\$" <<< "$sent" && return 0
  sent=$(printf '%s\nsent %s %s' "$sent" "$DAY" "$h")
  [ -n "$NOTIFY" ] && NOTIFY_KOD_KELUAR=1 "$NOTIFY" "$1" "$2" >/dev/null 2>&1
  return 0
}

bad=""
for p in / /api/health; do
  c=$(curl -s -o /dev/null -w '%{http_code}' -A "$UA" -m 25 "$URL$p" || true)
  [ "${c:-000}" = 200 ] || bad="$bad $p=${c:-000}"
done
ctr=$(docker inspect -f '{{.State.Status}}/{{.State.Health.Status}}' izin 2>/dev/null) || ctr=missing

if [ -z "$bad" ]; then
  [ "$prev" = down ] && send "Izin ($URL) pulih: laman dan /api/health 200, kontena $ctr. Tiada tindakan perlu." info
  prev=up; fails=0
else
  fails=$((fails + 1))
  if [ "$fails" -ge 2 ] && [ "$prev" = up ]; then
    text=$(node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).alerts.unhealthy)}catch(e){}' "$LANG_FILE" 2>/dev/null)
    send "${text:-Izin tidak sihat.} ($URL:$bad; kontena $ctr)" warn
    prev=down
  fi
fi

# Relay alerts the server logged since the last run (skipped when the container is missing).
if [ "$ctr" != missing ]; then
  while IFS= read -r msg; do
    [ -n "$msg" ] && send "Izin: $msg" warn
  done < <(docker logs izin --since "$last" 2>&1 \
    | node -e '
      let buf = ""; process.stdin.on("data", (d) => (buf += d)).on("end", () => {
        for (const line of buf.split("\n")) {
          try { const j = JSON.parse(line); if (typeof j.alert === "string" && j.delivered === false) console.log(j.alert.replace(/\s+/g, " ")); } catch (e) {}
        }
      });' 2>/dev/null)
fi

{ echo "$prev $fails $NOW"; grep . <<< "$sent" || true; } > "$STATE.tmp" && mv "$STATE.tmp" "$STATE"
exit 0
