#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

exec -- rclone --config /var/lib/local/rclone/rclone.conf "$@"
