#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

KUBECONFIG="${0%/*}/../facts/kubeconfig.yml.env" exec -- kubectl --insecure-skip-tls-verify "$@"
