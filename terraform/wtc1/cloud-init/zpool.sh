#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

exec -- zpool import -d /dev/disk/by-id/ -a -f
