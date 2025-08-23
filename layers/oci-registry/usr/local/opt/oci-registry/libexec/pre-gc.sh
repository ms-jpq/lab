#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

WORKDIR="$1"

DIRS=("$WORKDIR/docker/registry/v2/repositories"/*/*/)

printf -- '%s_layers/\0' "${DIRS[@]}" | xargs --no-run-if-empty --null -- mkdir -v -p --
