#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SRC="$1"
DST="$2"

cd -- "${0%/*}/.."

gmake helm >&2

K8S='kkkkkkkk'
MK_NS=(
  ./libexec/kubectl.sh
  "$SRC"
  create namespace
  --dry-run=client
  --output=yaml
)
TEMPLATE=(
  ./libexec/helm.sh
  "$SRC"
  template
  --create-namespace
  --include-crds
  --dependency-update
  --release-name "$K8S"
  --namespace
)

declare -A -- NAMESPACES=()
NS="$(./libexec/kubectl.sh "$SRC" get namespaces --output name | cut --delimiter '/' --fields 2-)"
readarray -t -- NSS <<< "$NS"
for N in "${NSS[@]}"; do
  NAMESPACES["$N"]=1
done

read -r -d '' -- JQ <<- 'JQ' || true
del(.metadata.creationTimestamp)
JQ

NAMESPACE='keel'
{
  ARGS=(
    "$NAMESPACE"
    --set helmProvider.version='v3'
    -- keel/keel
  )
  "${MK_NS[@]}" "$NAMESPACE" | ./libexec/yq.sh "$JQ"

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
  "${MK_NS[@]}" "$NAMESPACE" | ./libexec/yq.sh "$JQ"

  if [[ -n ${NAMESPACES["$NAMESPACE"]:-""} ]]; then
    "${TEMPLATE[@]}" "${ARGS[@]}"
  fi
} > "$DST/$NAMESPACE.yml"
