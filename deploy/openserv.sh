#!/usr/bin/env bash
# Run Izin's OpenServ agent (openserv/agent.ts) as its own small container, next to the main app.
#   deploy/openserv.sh            build HEAD from a clean `git archive` and (re)start the container
#   deploy/openserv.sh --status   container state and its last log lines
#   deploy/openserv.sh --stop     stop and remove the container (the listing stays registered but goes unanswered)
#
# The agent keeps an outbound tunnel to the platform, so it needs no route and no published port.
# Its identity lives in a host folder that is not tracked: IZIN_OPENSERV_STATE_DIR (deploy/hos.env)
# holds .env (OPENSERV_USER_API_KEY) and .openserv.json. Register once on the host before the first
# container start (see openserv/agent.ts); the container refuses to start without .openserv.json,
# so a wrong mount can never sign up a second identity.
set -euo pipefail
cd "$(dirname "$0")"
[ -r hos.env ] || { echo "deploy/hos.env missing"; exit 1; }
# shellcheck disable=SC1091
. ./hos.env
: "${IZIN_ENV_FILE:?}" "${IZIN_OPENSERV_STATE_DIR:?set IZIN_OPENSERV_STATE_DIR in deploy/hos.env}"
BUILD_CMD=${BUILD_CMD:-docker build}
NAME=izin-openserv

case "${1:-}" in
  --status)
    docker ps -a --filter "name=^${NAME}$" --format '{{.Names}}  {{.Image}}  {{.Status}}'
    docker logs --tail 15 "$NAME" 2>&1 | sed -E 's/(0x)?[0-9a-fA-F]{48,}/<hidden>/g' || true
    exit 0 ;;
  --stop)
    docker rm -f "$NAME" >/dev/null 2>&1 || true; echo "stopped"; exit 0 ;;
  "") ;;
  *) echo "usage: openserv.sh [--status|--stop]"; exit 2 ;;
esac

[ -r "$IZIN_OPENSERV_STATE_DIR/.openserv.json" ] || { echo "no .openserv.json in the state folder: register once on the host first"; exit 1; }
[ -z "$(git -C .. status --porcelain)" ] || { echo "working tree not clean: commit first (the image is built from HEAD)"; exit 1; }
# The payout address is the one the paid route on the site already uses.
pay_to=$(sed -n 's/^IZIN_X402_PAY_TO=//p' "$IZIN_ENV_FILE" | head -1)
[ -n "$pay_to" ] || { echo "IZIN_X402_PAY_TO is not set in the env file"; exit 1; }

TAG=$(git -C .. rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M)
ctx=$(mktemp -d); trap 'rm -rf "$ctx"' EXIT
git -C .. archive HEAD | tar -x -C "$ctx"
$BUILD_CMD -f "$ctx/openserv/Dockerfile" -t "$NAME:$TAG" "$ctx"

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped --cpus 0.25 --memory 384m --read-only --tmpfs /tmp \
  -v "$IZIN_OPENSERV_STATE_DIR:/state" -e IZIN_OPENSERV_REQUIRE_STATE=1 -e "IZIN_X402_PAY_TO=$pay_to" \
  "$NAME:$TAG" >/dev/null
# Keep only this image of the agent; the host disk is shared with other projects.
docker images "$NAME" --format '{{.Tag}}' | grep -vxF "$TAG" | sed "s/^/$NAME:/" | xargs -r docker rmi >/dev/null 2>&1 || true
sleep 8
docker ps --filter "name=^${NAME}$" --format '{{.Names}}  {{.Image}}  {{.Status}}'
docker logs --tail 8 "$NAME" 2>&1 | sed -E 's/(0x)?[0-9a-fA-F]{48,}/<hidden>/g'
