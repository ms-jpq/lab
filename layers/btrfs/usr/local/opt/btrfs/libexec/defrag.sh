#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SUBVOLUME="$1"
LIST=(btrfs subvolume list -- "$SUBVOLUME")
CUT=(cut --delimiter ' ' --fields 9-)
PARALLEL=(xargs --no-run-if-empty --null -I % --max-procs 0 --)
DEFRAG=(btrfs -v filesystem defragment -r -- %)

{
  printf -- '%s\0' "$SUBVOLUME"
  "${LIST[@]}" | "${CUT[@]}" | while read -r -- VOL; do
    VOL="$SUBVOLUME/$VOL"
    if btrfs property get -- "$VOL" ro | grep -F -- 'ro=false' >/dev/null; then
      printf -- '%s\0' "$VOL"
    fi
  done
} | "${PARALLEL[@]}" "${DEFRAG[@]}"
