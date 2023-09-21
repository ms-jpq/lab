#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ROOT="$1"
DRIVE="$2"
RAW='/var/cache/local/qemu/cloudimg.raw'

if ! [[ -e "$DRIVE" ]]; then
  RAW_ALLOC="${0%/*}/raw-alloc.sh"
  if [[ -x "$RAW_ALLOC" ]]; then
    "$RAW_ALLOC" "$ROOT" "$DRIVE" "$RAW"
  else
    /usr/local/libexec/hr-run.sh cp -v -f --reflink=auto -- "$RAW" "$DRIVE"
    /usr/local/libexec/hr-run.sh qemu-img resize -f raw -- "$DRIVE" +88G
  fi
fi
