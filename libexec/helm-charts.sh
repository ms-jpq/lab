#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

DST="$1"

cd -- "${0%/*}/.."

gmake helm

# POLICIES='./layers/k3s/usr/local/k8s'
MK_NS=(./libexec/kubectl.sh create namespace --dry-run=client --output=yaml)
TEMPLATE=(./libexec/helm.sh template --create-namespace --generate-name --dependency-update --namespace)

NAMESPACE='keel'
{
  ARGS=(
    "$NAMESPACE"
    --set helmProvider.version='v3'
    -- keel/keel
  )
  printf -- '%s\n' ---
  "${MK_NS[@]}" "$NAMESPACE"
  "${TEMPLATE[@]}" "${ARGS[@]}"
} > "$DST/$NAMESPACE.yml"

NAMESPACE='reloader'
{
  ARGS=(
    "$NAMESPACE"
    --set reloader.autoReloadAll=true
    --set reloader.reloadOnCreate=true
    --set reloader.reloadOnDelete=true
    -- stakater/reloader
  )
  "${MK_NS[@]}" "$NAMESPACE"
  "${TEMPLATE[@]}" "${ARGS[@]}"
} > "$DST/$NAMESPACE.yml"

# {
#   NAMESPACE='kubernetes-dashboard'
#   DOMAIN="$(sed -E -n -e 's/^ENV_DOMAIN=(.*)$/k8s.\1/p' -- ./facts/droplet.env)"
#   ARGS=(
#     "$NAMESPACE"
#     --set app.ingress.enabled=true
#     --set app.ingress.useDefaultIngressClass=true
#     --set app.ingress.tls.enabled=false
#     --set "app.ingress.hosts[0]=$DOMAIN"
#     -- kubernetes-dashboard/kubernetes-dashboard
#   )
#   K8S_NAMESPACE="$NAMESPACE" envsubst < "$POLICIES/networkpolicy.k8s.yml"
#   cat -- "$POLICIES/cluster-admin.k8s.yml"
#   "${TEMPLATE[@]}" "${ARGS[@]}"
# }

# TOKEN='./facts/cluster-admin.k8s.token.env'
# if ! [[ -s $TOKEN ]]; then
#   ./libexec/kubectl.sh --namespace "$NAMESPACE" get secret admin-user --output jsonpath='{.data.token}' | base64 -d > "$TOKEN"
# fi >&2
