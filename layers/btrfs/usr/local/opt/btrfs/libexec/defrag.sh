#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SUBVOLUME="$1"
PARENT="${2:-""}"

if [[ -n "$PARENT" ]]; then
  SUBVOLUME="$PARENT/$SUBVOLUME"
fi

btrfs subvolume list -o -- "$SUBVOLUME" | cut --delimiter ' ' --fields 9- | xargs --no-run-if-empty -I % --max-procs 0 -- "$0" % "$SUBVOLUME"
RO="$(btrfs property get -- "$SUBVOLUME" ro)"

if [[ "$RO" != 'ro=true' ]]; then
  exec -- btrfs -v filesystem defragment -r -- "$SUBVOLUME"
fi
