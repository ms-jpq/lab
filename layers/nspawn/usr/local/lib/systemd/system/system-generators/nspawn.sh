#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

RUN="$1"
cp -v --force -- /usr/lib/systemd/system/systemd-nspawn@.service "$RUN/1-nspawnd@.service"
