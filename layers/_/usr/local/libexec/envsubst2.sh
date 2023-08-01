#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
DST="$2"
shift -- 2

TMP="$(mktemp)"
envsubst "$@" <"$SRC" >"$TMP"
chmod -- g+r,o+r "$TMP"
mv -v --force -- "$TMP" "$DST"
