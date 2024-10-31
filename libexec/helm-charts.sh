#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

DST="$1"

cd -- "${0%/*}/.."

gmake helm >&2

K8S='kkkkkkkk'
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
  --release-name "$K8S"
  --namespace
)
APPLY=(
  ./libexec/kubectl.sh
  --dry-run=client
  --output=yaml
)

declare -A -- NAMESPACES=()
NS="$(./libexec/kubectl.sh get namespaces --output name | cut --delimiter '/' --fields 2-)"
readarray -t -- NSS <<< "$NS"
for N in "${NSS[@]}"; do
  NAMESPACES["$N"]=1
done

NAMESPACE='keel'
{
  ARGS=(
    "$NAMESPACE"
    --set helmProvider.version='v3'
    -- keel/keel
  )
  printf -- '%s\n' ---
  "${MK_NS[@]}" "$NAMESPACE"

  if [[ -n ${NAMESPACES["$NAMESPACE"]} ]]; then
    "${TEMPLATE[@]}" "${ARGS[@]}"
  fi
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
  printf -- '%s\n' ---
  "${MK_NS[@]}" "$NAMESPACE"

  if [[ -n ${NAMESPACES["$NAMESPACE"]} ]]; then
    "${TEMPLATE[@]}" "${ARGS[@]}"
  fi
} > "$DST/$NAMESPACE.yml"

NAMESPACE='kubernetes-dashboard'
SERVICE_ACC="$K8S-admin"
{
  DOMAIN="$(sed -E -n -e 's/^ENV_DOMAIN=(.*)$/k8s.\1/p' -- ./facts/droplet.env)"
  ARGS=(
    "$NAMESPACE"
    --set app.security.networkPolicy.enabled=true
    --set app.ingress.enabled=true
    --set app.ingress.useDefaultIngressClass=true
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
  "${APPLY[@]}" --namespace "$NAMESPACE" create secret generic --type='kubernetes.io/service-account-token' "$SERVICE_ACC" | ./libexec/yq.sh --arg a "$SERVICE_ACC" '.metadata.annotations={"kubernetes.io/service-account.name": $a}'

  read -r -d '' -- JQ <<- 'JQ' || true
.[]
| . // empty
| if (.kind | IN(["ServiceAccount", "Role", "RoleBinding", "Deployment", "StatefulSet", "ConfigMap", "Secret", "NetworkPolicy", "Service", "Ingress"][])) then
    .metadata.namespace = $ns
  else
    .
  end
JQ
  if [[ -n ${NAMESPACES["$NAMESPACE"]} ]]; then
    "${TEMPLATE[@]}" "${ARGS[@]}" | ./libexec/yq.sh --slurp --arg ns "$NAMESPACE" "$JQ"
  fi
} > "$DST/$NAMESPACE.yml"

# TOKEN='./facts/cluster-admin.k8s.token.env'
# ./libexec/kubectl.sh --namespace "$NAMESPACE" get secret "$SERVICE_ACC" --output jsonpath='{.data.token}' | base64 -d > "$TOKEN"
# printf -- '%s\n' ">>> $TOKEN" >&2
