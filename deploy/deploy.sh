#!/usr/bin/env bash
# Deploy Izin as one container behind the host's reverse proxy.
#   deploy/deploy.sh                    build HEAD from a clean `git archive`, run it, install the route, verify
#   deploy/deploy.sh --seed-db <file>   same, and on the FIRST deploy copy <file> into the empty data volume
#                                       (carries the spending ledger of earlier paid runs into production)
#   deploy/deploy.sh --rollback         run the previous image again (held by the stopped `izin-undur` container)
#   deploy/deploy.sh --status           container, tags, rollback image and the public health code
#
# Host values live in deploy/hos.env (not tracked; see the variable list below). The API keys stay in the
# file IZIN_ENV_FILE points to and reach the container as environment only: never the image, never the repo.
set -euo pipefail
cd "$(dirname "$0")"
[ -r hos.env ] || { echo "deploy/hos.env missing"; exit 1; }
# shellcheck disable=SC1091
. ./hos.env
: "${IZIN_ENV_FILE:?}" "${IZIN_NETWORK:?}" "${IZIN_DOMAIN:?}" "${PROXY_CONTAINER:?}" "${PROXY_DYNAMIC_DIR:?}" "${CERT_RESOLVER:?}"
BUILD_CMD=${BUILD_CMD:-docker build}   # an image builder that accepts `docker build` arguments
MIN_FREE_GB=${MIN_FREE_GB:-8}
export IZIN_ENV_FILE IZIN_NETWORK
DC="docker compose -f compose.yaml"
URL="https://$IZIN_DOMAIN"
HOLDER=izin-undur

health_code() { curl -s -m 20 -o /dev/null -w '%{http_code}' "$URL/api/health" || true; }

hold_previous() {  # $1 = image ID the replaced container ran: keep it by ID in a stopped container
  local prev id=${1:-}
  prev=$(cat PREVIOUS_TAG 2>/dev/null) || { echo "note: first deploy, no rollback image yet"; return 0; }
  [ -n "$id" ] || id=$(docker image inspect -f '{{.Id}}' "izin:$prev" 2>/dev/null) || id=""
  [ -n "$id" ] || { echo "WARNING: rollback image izin:$prev not found; --rollback will fail" >&2; return 1; }
  docker rm -f "$HOLDER" >/dev/null 2>&1 || true
  docker tag "$id" "izin:$prev"
  docker create --name "$HOLDER" --network none --restart no --label "izin.tag=$prev" "izin:$prev" >/dev/null
  echo "rollback image held: izin:$prev (${id:7:12})"
}

seed=""
case "${1:-}" in
  --status)
    $DC ps
    echo "current $(cat CURRENT_TAG 2>/dev/null || echo -) · previous $(cat PREVIOUS_TAG 2>/dev/null || echo -)"
    docker inspect -f 'rollback holder: {{index .Config.Labels "izin.tag"}}' "$HOLDER" 2>/dev/null || echo "rollback holder: none"
    echo "public /api/health $(health_code)"; exit 0 ;;
  --rollback)
    TAG=$(cat PREVIOUS_TAG 2>/dev/null) || { echo "no PREVIOUS_TAG"; exit 1; }
    if ! docker image inspect "izin:$TAG" >/dev/null 2>&1; then
      id=$(docker inspect -f '{{.Image}}' "$HOLDER" 2>/dev/null) || { echo "image izin:$TAG is gone"; exit 1; }
      docker tag "$id" "izin:$TAG"
    fi
    [ -r CURRENT_TAG ] && cp CURRENT_TAG PREVIOUS_TAG ;;
  ""|--seed-db)
    if [ "${1:-}" = --seed-db ]; then seed=$(realpath "${2:?--seed-db needs a file}"); [ -r "$seed" ] || { echo "cannot read $seed"; exit 1; }; fi
    [ -z "$(git -C .. status --porcelain)" ] || { echo "working tree not clean: commit first (the image is built from HEAD)"; exit 1; }
    free=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
    [ "$free" -ge "$MIN_FREE_GB" ] || { echo "less than ${MIN_FREE_GB} GB free on /, stopping"; exit 1; }
    TAG=$(git -C .. rev-parse --short HEAD)-$(date -u +%Y%m%d%H%M)
    ctx=$(mktemp -d); trap 'rm -rf "$ctx"' EXIT
    git -C .. archive HEAD | tar -x -C "$ctx"   # clean tree: untracked and ignored files never reach the image
    $BUILD_CMD -t "izin:$TAG" "$ctx"
    [ -r CURRENT_TAG ] && cp CURRENT_TAG PREVIOUS_TAG ;;
  *) echo "usage: deploy.sh [--seed-db <file>|--rollback|--status]"; exit 2 ;;
esac

old_id=$(docker inspect -f '{{.Image}}' izin 2>/dev/null || true)

if [ -n "$seed" ]; then
  docker volume create izin-data >/dev/null
  docker run --rm --network none --user node -v izin-data:/app/data -v "$seed:/seed.db:ro" --entrypoint sh "izin:$TAG" \
    -c '[ -e /app/data/izin.db ] && echo "volume already has a database: seed skipped" || { cp /seed.db /app/data/izin.db && echo "database seeded"; }'
fi

IZIN_TAG=$TAG $DC up -d --force-recreate izin
echo "$TAG" > CURRENT_TAG

route=$(mktemp)
sed -e "s|@DOMAIN@|$IZIN_DOMAIN|g" -e "s|@CERT_RESOLVER@|$CERT_RESOLVER|g" traefik.yaml.tmpl > "$route"
docker cp "$route" "$PROXY_CONTAINER:$PROXY_DYNAMIC_DIR/izin.yaml"; rm -f "$route"

for _ in $(seq 30); do [ "$(docker inspect -f '{{.State.Health.Status}}' izin)" = healthy ] && break; sleep 3; done
no_rollback=0; hold_previous "$old_id" || no_rollback=1

# Keep only the current and previous images of this project; the host disk is shared with other projects.
docker images izin --format '{{.Tag}}' | grep -vxF -e "$TAG" -e "$(cat PREVIOUS_TAG 2>/dev/null || echo -)" \
  | sed 's/^/izin:/' | xargs -r docker rmi >/dev/null 2>&1 || true

# A new route or certificate can take a little while: wait and retry before calling it a failure.
code=000
for _ in $(seq 6); do code=$(health_code); [ "$code" = 200 ] && break; sleep 10; done
echo "tag $TAG · public /api/health $code"
[ "$code" = 200 ] || { echo "public health is not 200 yet: check the certificate and route; undo with deploy/deploy.sh --rollback"; exit 1; }
[ "$no_rollback" = 0 ] || { echo "live, but no rollback image is held (warning above)"; exit 1; }
