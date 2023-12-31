#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

exec -- docker run --rm -ti --volume /run/docker.sock:/var/run/docker.sock:ro -- quay.io/vektorlab/ctop:latest -i
