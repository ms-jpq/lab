#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

gmake helm

INSTALL=(./libexec/helm.sh upgrade --cleanup-on-fail --atomic --create-namespace --install --namespace)
"${INSTALL[@]}" keel --set helmProvider.version='v3' -- keel keel/keel
"${INSTALL[@]}" reloader -- reloader stakater/reloader
