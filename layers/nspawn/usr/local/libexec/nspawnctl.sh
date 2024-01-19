#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

export -- TARGET='machines' SERVICE_NAME='2-nspawnd' LIB='/var/lib/local/nspawn' DEALLOC='/usr/local/opt/nspawn/libexec/fs-dealloc.sh'
