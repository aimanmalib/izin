#!/usr/bin/env bash
# Local and CI gate: lint, types, unit tests (no network), build. Browser e2e runs when specs exist.
set -euo pipefail
cd "$(dirname "$0")/.."
export IZIN_FAKE=1

step() { printf '\n== %s\n' "$1"; }

step lint;      npm run --silent lint
step typecheck; npm run --silent typecheck
step unit;      npx vitest run --reporter=dot
step build;     npm run --silent build

if compgen -G "e2e/*.spec.ts" >/dev/null; then
  step e2e
  if [ "${CI:-}" = "1" ]; then npx playwright install --with-deps chromium webkit >/dev/null; fi
  npx playwright test
fi

printf '\ngate: ok\n'
