#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

export -- SERVICE_NAME='2-nspawnd' LIB='nspawn'
