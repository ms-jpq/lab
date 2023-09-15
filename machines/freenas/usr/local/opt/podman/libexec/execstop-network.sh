#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

UNIT="$1"
NAME="${UNIT%-*}"
/usr/local/libexec/hr-run.sh podman network rm --force -- "systemd-$NAME"
