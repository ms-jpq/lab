#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

PYTHONPATH="$(realpath -- "${0%/*}/..")"
export -- PYTHONPATH
exec -- /var/cache/local/venvs/crawler/bin/python3 -m libexec "$@"
