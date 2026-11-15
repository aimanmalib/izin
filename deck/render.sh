#!/usr/bin/env bash
# Convert deck/izin.pptx to PDF and one PNG per slide (both in deck/build/), so the plain slides
# can be checked as images. docs/deck.pdf is the designed version of the same text and is not
# written here. LibreOffice runs in a throwaway container; nothing is installed on the host.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="python:3.12-alpine@sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8"
mkdir -p deck/build

docker run --rm --name izin-deck-render --cpus 1 --network bridge \
  -v "$PWD/deck:/work/deck" -w /work/deck \
  --tmpfs /root:exec --tmpfs /tmp:exec \
  "$IMAGE" sh -euc '
    apk add --no-cache -q libreoffice font-liberation poppler-utils >/dev/null 2>&1
    HOME=/tmp soffice --headless --norestore --convert-to pdf --outdir build izin.pptx >/dev/null 2>&1
    rm -f build/slide-*.png
    pdftoppm -r 72 -png build/izin.pdf build/slide
    chown -R '"$(id -u):$(id -g)"' build
  '
ls deck/build/slide-*.png | wc -l | xargs -I{} echo "deck/build/izin.pdf + {} PNG pages in deck/build/"
