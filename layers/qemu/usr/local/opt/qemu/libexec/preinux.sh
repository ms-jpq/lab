#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MACHINE="$1"
ROOT="$2"
DRIVE="$3"
RAW='/var/cache/local/qemu/cloudimg.raw'
HR='/usr/local/libexec/hr-run.sh'

"${0%/*}/apriori.sh" "$MACHINE" "$ROOT"

if ! [[ -f "$DRIVE" ]]; then
  "$HR" cp -v -f --reflink=auto -- "$RAW" "$DRIVE"
  "$HR" qemu-img resize -f raw -- "$DRIVE" +88G
fi
