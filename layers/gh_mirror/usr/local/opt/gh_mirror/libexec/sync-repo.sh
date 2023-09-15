#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"
URI="$2"
BASENAME="${URI##*/}"
BASENAME="${BASENAME%.git}"
DIR="$RUN/$BASENAME"

NPROC="$(nproc)"

if ! [[ -d "$DIR" ]]; then
  git clone --jobs="$NPROC" -- "$URI" "$DIR"
  cd -- "$DIR"
else
  cd -- "$DIR"
  git fetch --jobs="$NPROC"
fi
