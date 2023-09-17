#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MACHINE="$1"
ROOT="$2"
DRIVE="$3"
RAW='/var/cache/local/qemu/cloudimg.raw'

"${0%/*}/apriori.sh" "$MACHINE" "$ROOT"

if ! [[ -f "$DRIVE" ]]; then
  /usr/local/libexec/hr-run.sh cp -v -f --reflink=auto -- "$RAW" "$DRIVE"
  /usr/local/libexec/hr-run.sh qemu-img resize -f raw -- "$DRIVE" +88G
fi
