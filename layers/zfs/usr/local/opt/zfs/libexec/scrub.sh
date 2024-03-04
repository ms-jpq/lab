#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

POOL="$1"

SCRUB=0
while zpool status -- "$POOL" | grep --fixed-string -- 'scrub in progress'; do
  SCRUB=1
  sleep -- 600
done

if ! ((SCRUB)); then
  exec -- zpool scrub -w -- "$POOL"
fi
