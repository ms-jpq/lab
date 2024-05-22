#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

DST="$1"
_="$2"
SRC="$3"
shift -- 3

USERNAME="$(id --name --user -- 1000)"
{
  USERNAME="$USERNAME" envsubst < "$SRC"
  cat -- /dev/null "$@"
} > "$DST"
