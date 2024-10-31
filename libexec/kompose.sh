#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

cd -- "${0%/*}/.."

SRC="$1"
DST="$2"
shift -- 2

COMPOSE="./var/tmp/machines/$SRC/fs/usr/local/k8s"
KOMPOSE='var/bin/kompose'
POLICIES='./layers/k3s/usr/local/k8s'
DENV='./var/sh/zsh/dev/bin/denv.py'

gmake "$KOMPOSE"
gmake MACHINE="$SRC" local

if (($#)); then
  FILES=("$COMPOSE/$*"/docker-compose.yml)
else
  FILES=("$COMPOSE"/*/docker-compose.yml)
fi

read -r -d '' -- JQ <<- 'JQ' || true
sort_by(.kind != "Namespace")[]
| if (.kind | IN(["Deployment", "StatefulSet"][])) then
    .metadata.annotations += $keel
    | .spec.template.metadata.annotations += $keel
    | .spec.template.spec.containers[].imagePullPolicy ?= "Always"
    | .spec.template.spec.initContainers?.[]?.imagePullPolicy ?= "Always"
    | .spec.template.spec.initContainers?.[]?.env ?= (.spec.template.spec.containers[].env // [])
  else
    .
  end
JQ
KEEL="$(< "$POLICIES/keel.json")"

printf -- '%s\n' ">>> $COMPOSE" >&2
for FILE in "${FILES[@]}"; do
  DIR="${FILE%/*}"
  NAMESPACE="kompsed-${DIR##*/}"
  ENV="$DIR/.env"
  YAML="$DST/$NAMESPACE.yml"

  printf -- '%s\n' "@ $NAMESPACE" >&2
  touch -- "$ENV"
  CONV=("$DENV" -- "$ENV" "$KOMPOSE" convert --stdout --generate-network-policies --namespace "$NAMESPACE" --file "$FILE")
  {
    "${CONV[@]}" | ./libexec/yq.sh --sort-keys --slurp "$JQ" --argjson keel "$KEEL"
    K8S_NAMESPACE="$NAMESPACE" envsubst < "$POLICIES/networkpolicy.k8s.yml"
  } > "$YAML"
done
printf -- '%s\n' "<<< $DST" >&2