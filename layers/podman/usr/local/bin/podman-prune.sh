#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

NAME="${0##*/}"
NAME="${NAME%-prune.sh}"

"$NAME" system prune --all --volumes --force
"$NAME" network prune --force
"$NAME" image prune --all --force
