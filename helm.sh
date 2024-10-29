#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

gmake helm

RELEASE='latest'
INSTALL=(./libexec/helm.sh upgrade --cleanup-on-fail --atomic --create-namespace --install --namespace)

"${INSTALL[@]}" keel --set helmProvider.version='v3' -- "$RELEASE" keel/keel

"${INSTALL[@]}" reloader --set reloader.autoReloadAll=true --set reloader.reloadOnCreate=true --set reloader.reloadOnDelete=true -- "$RELEASE" stakater/reloader
