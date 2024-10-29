#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

cd -- "${0%/*}"

SRC="$1"
shift -- 1

DST="./var/tmp/k8s/$SRC"
COMPOSE="./var/tmp/machines/$SRC/fs/usr/local/k8s"
KOMPOSE='var/bin/kompose'
HELM='var/bin/helm'
POLICIES='./layers/k3s/usr/local/k8s'
DENV='./var/sh/zsh/dev/bin/denv.py'

gmake "$KOMPOSE" "$HELM"
gmake MACHINE="$SRC" local
mkdir -p -- "$DST"
rm -fr -- "${DST:?}"/*

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
    | .spec.template.spec.containers[].imagePullPolicy = "Always"
    | .spec.template.spec.initContainers?.[]?.imagePullPolicy ?= "Always"
  else
    .
  end
JQ
KEEL="$(< "$POLICIES/keel.json")"

NAMESPACES=()
printf -- '%s\n' ">>> $COMPOSE" >&2
for FILE in "${FILES[@]}"; do
  DIR="${FILE%/*}"
  NAMESPACE="${DIR##*/}"
  ENV="$DIR/.env"
  NAMESPACES+=("$NAMESPACE")

  printf -- '%s\n' "@ $NAMESPACE" >&2
  touch -- "$ENV"
  CONV=("$DENV" -- "$ENV" "$KOMPOSE" convert --stdout --generate-network-policies --namespace "$NAMESPACE" --file "$FILE")
  {
    "${CONV[@]}" | ./libexec/yq.sh --sort-keys --slurp "$JQ" --argjson keel "$KEEL"
    K8S_NAMESPACE="$NAMESPACE" envsubst < "$POLICIES/networkpolicy.k8s.yml"
  } > "$DST/$NAMESPACE.yml"
done
printf -- '%s\n' "<<< $DST" >&2

for NAMESPACE in "${NAMESPACES[@]}"; do
  printf -- '%s\n' "@ $NAMESPACE" >&2
  ./libexec/kubectl.sh apply --namespace "$NAMESPACE" --filename "$DST/$NAMESPACE.yml"
done
