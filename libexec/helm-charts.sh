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

  if [[ -n ${NAMESPACES["$NAMESPACE"]:-""} ]]; then
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

  if [[ -n ${NAMESPACES["$NAMESPACE"]:-""} ]]; then
    "${TEMPLATE[@]}" "${ARGS[@]}"
  fi
} > "$DST/$NAMESPACE.yml"
