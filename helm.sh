#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

./libexec/kubectl.sh create namespace --dry-run client --output yaml -- keel | ./libexec/kubectl.sh apply -f -
./libexec/helm.sh upgrade --install keel --namespace=keel keel/keel --set helmProvider.version='v3'
