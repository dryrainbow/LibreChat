#!/usr/bin/env bash
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo"
export PATH="$HOME/.local/bin:$PATH"
pi=${PI_SSH:-librechat-pi}
key=${PI_SSH_KEY:-$HOME/.ssh/librechat_pi_ed25519}
socket_dir=$(mktemp -d)
socket=$socket_dir/ssh
cleanup() {
  ssh -S "$socket" -O exit "$pi" >/dev/null 2>&1 || true
  rm -rf -- "$socket_dir"
}
trap cleanup EXIT INT TERM
ssh -i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
  -o ExitOnForwardFailure=yes -M -S "$socket" -fNT \
  -L 127.0.0.1:13080:127.0.0.1:3080 "$pi"
export HOST=127.0.0.1 BACKEND_PORT=13080 PORT=3090 HERMES_DEV_HTTP=1
npm run frontend:dev
