#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SWAP='/var/lib/docker/swapfile'
dd bs=1M count=1024 if=/dev/zero of="$SWAP"
chmod -- 600 "$SWAP"
mkswap -- "$SWAP"
