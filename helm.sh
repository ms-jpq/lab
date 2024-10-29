#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

gmake helm

RELEASE='latest'
INSTALL=(./libexec/helm.sh upgrade --cleanup-on-fail --atomic --create-namespace --install --namespace)

{
  ARGS=(
    keel
    --set helmProvider.version='v3'
    -- "$RELEASE" keel/keel
  )
  "${INSTALL[@]}" "${ARGS[@]}"
}

{
  ARGS=(
    reloader
    --set reloader.autoReloadAll=true
    --set reloader.reloadOnCreate=true
    --set reloader.reloadOnDelete=true
    -- "$RELEASE" stakater/reloader
  )
  "${INSTALL[@]}" "${ARGS[@]}"
}

{
  POLICIES='./layers/k3s/usr/local/k8s'
  NAMESPACE='kubernetes-dashboard'
  DOMAIN="$(sed -E -n -e 's/^ENV_DOMAIN=(.*)$/k8s.\1/p' -- ./facts/droplet.env)"
  ARGS=(
    "$NAMESPACE"
    --set app.ingress.enabled=true
    --set app.ingress.useDefaultIngressClass=true
    --set app.ingress.tls.enabled=false
    --set "app.ingress.hosts[0]=$DOMAIN"
    -- "$RELEASE" kubernetes-dashboard/kubernetes-dashboard
  )
  "${INSTALL[@]}" "${ARGS[@]}"
  {
    K8S_NAMESPACE="$NAMESPACE" envsubst < "$POLICIES/networkpolicy.k8s.yml"
    cat -- "$POLICIES/cluster-admin.k8s.yml"
  } | ./libexec/kubectl.sh apply --filename -

  TOKEN='./facts/cluster-admin.k8s.token.env'
  if ! [[ -s $TOKEN ]]; then
    ./libexec/kubectl.sh --namespace "$NAMESPACE" get secret admin-user --output jsonpath='{.data.token}' | base64 -d > "$TOKEN"
  fi
}
