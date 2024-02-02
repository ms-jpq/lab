#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

PREFIX='/var/lib/docker'
mkdir -v -p -- "$PREFIX"
SWAP="$PREFIX/swapfile"
fallocate --length 6G -- "$SWAP"
chmod -- 600 "$SWAP"
mkswap -- "$SWAP"
