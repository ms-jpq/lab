#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
DST="$2"
ENV="$3"
shift -- 3

readarray -t -- DEFS < "$ENV"

ACC=()
for D in "${DEFS[@]}"; do
  if [[ -n $D ]]; then
    # env.sh emits scalar facts via @Q (wrapped in single quotes); m4 -D
    # wants the raw value. Strip one surrounding pair, leaving unquoted
    # facts (which may carry spaces or '=') untouched.
    V="${D#*=}"
    if [[ $V == \'*\' ]]; then
      V="${V#\'}"
      V="${V%\'}"
    fi
    ACC+=("-D${D%%=*}=$V")
  fi
done

exec -- ./layers/_/usr/local/libexec/m4.sh "${ACC[@]}" "$@" -- "$SRC" > "$DST"
