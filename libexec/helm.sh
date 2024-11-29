#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

SRC="$1"
shift -- 1

export -- HELM_CACHE_HOME=./var/helm/cache
export -- HELM_CONFIG_HOME=./var/helm/config
export -- HELM_DATA_HOME=./var/helm/data
export -- KUBECONFIG="./facts/$SRC.kubeconfig.yml.env"

exec -- ./var/bin/helm --kube-insecure-skip-tls-verify "$@"
