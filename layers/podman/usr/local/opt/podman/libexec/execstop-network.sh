#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

UNIT="$1"
NAME="${UNIT%-*}"
exec -- podman network rm --force -- "systemd-$NAME"
