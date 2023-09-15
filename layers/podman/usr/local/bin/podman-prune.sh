#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

podman system prune --all --volumes --force
podman network prune --force
podman image prune --all --force
