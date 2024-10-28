#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

SRC="$1"
DST="./var/tmp/k8s/$SRC"
COMPOSE="./var/tmp/machines/$SRC/fs/usr/local/k8s"
KOMPOSE='var/bin/kompose'
POLICIES='./layers/k3s/usr/local/k8s'
DENV='./var/sh/zsh/dev/bin/denv.py'

gmake "$KOMPOSE"
gmake MACHINE="$SRC" local
rm -fr -- "$DST"
mkdir -p -- "$DST"

read -r -d '' -- JQ <<- 'JQ' || true
sort_by(.kind != "Namespace")[]
| if (.kind | IN(["Deployment", "StatefulSet"][])) then
    .metadata.annotations += $keel
    | .spec.template.metadata.annotations += $keel
    | .spec.template.spec.containers[].imagePullPolicy = "Always"
  else
    .
  end
JQ
KEEL="$(< "$POLICIES/keel.json")"

printf -- '%s\n' ">>> $COMPOSE" >&2
for FILE in "$COMPOSE"/*/docker-compose.yml; do
  DIR="${FILE%/*}"
  NAMESPACE="${DIR##*/}"
  ENV="$DIR/.env"

  printf -- '%s\n' "@ $NAMESPACE" >&2
  touch -- "$ENV"
  CONV=("$DENV" -- "$ENV" "$KOMPOSE" convert --stdout --generate-network-policies --namespace "$NAMESPACE" --file "$FILE")
  {
    "${CONV[@]}" | ./libexec/yq.sh --slurp "$JQ" --argjson keel "$KEEL"
    K8S_NAMESPACE="$NAMESPACE" envsubst < "$POLICIES/networkpolicy.k8s.yml"
  } > "$DST/$NAMESPACE.yml"
done
printf -- '%s\n' "<<< $DST" >&2
