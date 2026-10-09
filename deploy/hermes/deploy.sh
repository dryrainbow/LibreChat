#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 2 ]; then
  printf 'Usage: %s ARTIFACT.tar.gz MANIFEST.json\n' "$0" >&2
  exit 2
fi
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
archive=$(realpath -- "$1")
manifest=$(realpath -- "$2")
archive_name=$(basename -- "$archive")
manifest_name=$(basename -- "$manifest")
for name in "$archive_name" "$manifest_name"; do
  [[ $name =~ ^librechat-v[0-9a-z.-]+\.(tar\.gz|json)$ ]] || {
    printf 'Unexpected artifact filename.\n' >&2; exit 2;
  }
done
test -f "$archive.sha256"
pi=${PI_SSH:-librechat-pi}
key=${PI_SSH_KEY:-$HOME/.ssh/librechat_pi_ed25519}
ssh_options=(-i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes)
upload=$(date -u +%Y%m%dT%H%M%SZ)-$$
incoming=.local/share/librechat/incoming/$upload
ssh "${ssh_options[@]}" "$pi" "umask 077; mkdir -p '$incoming'"
scp "${ssh_options[@]}" "$archive" "$archive.sha256" "$manifest" \
  "$script_dir/activate.py" "$pi:$incoming/"
ssh "${ssh_options[@]}" "$pi" \
  "python3 '$incoming/activate.py' '$incoming/$archive_name' '$incoming/$manifest_name'"
