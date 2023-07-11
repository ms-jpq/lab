#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

SRC="$1"
DST="$2"

if [[ -L "$SRC" ]] && [[ "$SRC" =~ ^! ]]; then
  FLAGS=(-L)
else
  FLAGS=(-P)
fi

mkdir -p -- "${DST%/*}"
exec -- cp "${FLAGS[@]}" -f -- "$SRC" "$DST"
