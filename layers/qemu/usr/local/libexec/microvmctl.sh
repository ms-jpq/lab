#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

export -- SERVICE_NAME='2-qemu-microvm' LIB='/var/lib/local/qemu' DEALLOC='/usr/local/opt/qemu/libexec/fs-dealloc.sh'
