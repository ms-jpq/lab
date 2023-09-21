#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

DRIVE="$3"

if ! [[ -e "$DRIVE" ]]; then
  /usr/local/libexec/hr-run.sh qemu-img create -f raw -- "$DRIVE" 88G
fi
