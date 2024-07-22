#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

RUN="$1"

cp -f -- /usr/local/lib/systemd/system/0-webdav-ro.service "$RUN/0-webdav-rw.service"
