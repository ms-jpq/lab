#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

PYTHONPATH="$(realpath -- "${0%/*}/.."):/opt/python3/elasticsearch"
export -- PYTHONPATH
exec -- python3 -m libexec "$@"
