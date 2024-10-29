#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

gmake helm

RELEASE='latest'
INSTALL=(./libexec/helm.sh upgrade --cleanup-on-fail --atomic --create-namespace --install --namespace)

"${INSTALL[@]}" keel --set helmProvider.version='v3' -- "$RELEASE" keel/keel

"${INSTALL[@]}" reloader --set reloader.autoReloadAll=true --set reloader.reloadOnCreate=true --set reloader.reloadOnDelete=true -- "$RELEASE" stakater/reloader

"${INSTALL[@]}" kubernetes-dashboard -- "$RELEASE" kubernetes-dashboard/kubernetes-dashboard

./libexec/kubectl.sh apply -f ./layers/k3s/usr/local/k8s/cluster-admin.k8s.yml
