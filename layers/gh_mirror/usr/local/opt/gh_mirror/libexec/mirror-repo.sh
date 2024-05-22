#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"
BARE="$RUN/bare"
WORKSPACE="$RUN/workspace"

URI="$2"
BASENAME="${URI##*/}"
BASENAME="${BASENAME%.git}"
MIRROR="$BARE/$BASENAME"
COPY="$WORKSPACE/$BASENAME"

NPROC="$(nproc)"
mkdir -v -p -- "$BARE" "$WORKSPACE"

if ! [[ -d $MIRROR ]]; then
  git clone --mirror --jobs="$NPROC" -- "$URI" "$MIRROR"
else
  pushd -- "$MIRROR"
  git remote update --prune
  popd
fi

if ! [[ -d $COPY ]]; then
  git clone --jobs="$NPROC" -- "$MIRROR" "$COPY"
else
  pushd -- "$COPY"
  git fetch --jobs="$NPROC" --all --prune
  git reset --hard
  popd
fi
