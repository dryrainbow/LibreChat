#!/usr/bin/env bash
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo"
export PATH="$HOME/.local/bin:$PATH"
export MONGOMS_DISABLE_POSTINSTALL=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
case "${1:-}" in
  '')
    npm ci --no-audit --no-fund
    npm run frontend
    ;;
  --package-only) ;;
  *) printf 'Usage: %s [--package-only]\n' "$0" >&2; exit 2 ;;
esac
python3 deploy/hermes/package.py "${ARTIFACT_DIR:-$repo/../artifacts}"
