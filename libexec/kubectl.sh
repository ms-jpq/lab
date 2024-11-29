#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
shift -- 1

KUBECONFIG="${0%/*}/../facts/$SRC.kubeconfig.yml.env" exec -- kubectl --insecure-skip-tls-verify "$@"
