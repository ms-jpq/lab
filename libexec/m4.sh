#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
DST="$2"
ENV="$3"

readarray -t -- DEFS <"$ENV"

ACC=()
for D in "${DEFS[@]}"; do
  ACC+=("-D$D")
done

exec -- ./layers/_/usr/local/libexec/m4.sh "${ACC[@]}" -- "$SRC" >"$DST"
