#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

export -- TARGET='0-qemu' SERVICE_NAME='2-qemu-microvm' LIB='/var/lib/local/qemu'
