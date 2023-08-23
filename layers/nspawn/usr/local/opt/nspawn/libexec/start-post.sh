#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

# MACHINE="$1"

# until resolvectl query --cache no -- "$MACHINE"; do
#   sleep -- 1
# done

# until ping -c 1 -w 1 -- "$MACHINE"; do
#   sleep -- 1
# done
