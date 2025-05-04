#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LOG="$1"
NAME="${LOG##*/}"
NAME="${NAME%-*}"

tail --lines +1 --follow -- "$LOG" | systemd-cat --identifier "$NAME"
