#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

DST="$1"

cd -- "${0%/*}/.."

gmake helm >&2

MK_NS=(
  ./libexec/kubectl.sh
  create namespace
  --dry-run=client
  --output=yaml
)
TEMPLATE=(
  ./libexec/helm.sh
  template
  --create-namespace
  --include-crds
  --dependency-update
  --release-name 'kkkkkkkk'
  --namespace
)
APPLY=(
  ./libexec/kubectl.sh
  --dry-run=client
  --output=yaml
)

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

NAMESPACE='kubernetes-dashboard'
{
  SERVICE_ACC='kkkkkkkk-admin'
  DOMAIN="$(sed -E -n -e 's/^ENV_DOMAIN=(.*)$/k8s.\1/p' -- ./facts/droplet.env)"
  ARGS=(
    "$NAMESPACE"
    --set app.ingress.enabled=true
    --set app.ingress.useDefaultIngressClass=true
    --set app.ingress.tls.enabled=false
    --set "app.ingress.hosts[0]=$DOMAIN"
    -- kubernetes-dashboard/kubernetes-dashboard
  )

  printf -- '%s\n' ---
  "${APPLY[@]}" create namespace "$NAMESPACE"
  K8S_NAMESPACE="$NAMESPACE" envsubst < ./layers/k3s/usr/local/k8s/networkpolicy.k8s.yml
  printf -- '%s\n' ---
  "${APPLY[@]}" --namespace "$NAMESPACE" create serviceaccount "$SERVICE_ACC"
  printf -- '%s\n' ---
  "${APPLY[@]}" create clusterrolebinding --clusterrole=cluster-admin --serviceaccount="$NAMESPACE:$SERVICE_ACC" "$SERVICE_ACC"
  # shellcheck disable=SC2016
  "${APPLY[@]}" --namespace "$NAMESPACE" create secret generic --type='kubernetes.io/service-account-token' "$SERVICE_ACC" | ./libexec/yq.sh '.metadata.annotations={"kubernetes.io/service-account.name": $a}' --arg a "$SERVICE_ACC"
  "${TEMPLATE[@]}" "${ARGS[@]}"
} > "$DST/$NAMESPACE.yml"

# TOKEN='./facts/cluster-admin.k8s.token.env'
# if ! [[ -s $TOKEN ]]; then
#   ./libexec/kubectl.sh --namespace "$NAMESPACE" get secret admin-user --output jsonpath='{.data.token}' | base64 -d > "$TOKEN"
# fi >&2
