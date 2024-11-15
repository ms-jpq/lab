#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

cd -- "${0%/*}/.."

SRC="$1"
DST="$2"
shift -- 2

MACHINE='k8s'
COMPOSE="./$MACHINE"
SH='var/sh'
KOMPOSE='var/bin/kompose'
DENV="$SH/zsh/dev/bin/denv.py"

gmake "$SH" "$KOMPOSE"

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
KEEL="$(< "$COMPOSE/keel.json")"

DEFS="$DST/.env"
./libexec/facts.sh "$MACHINE" "./facts/$SRC.k8s".{env,json} > "$DEFS"

printf -- '%s\n' ">>> $COMPOSE" >&2
for FILE in "${FILES[@]}"; do
  DIR="${FILE%/*}"
  NAMESPACE="kompsed-${DIR##*/}"
  ENV="$DIR/.env"
  YAML="$DST/$NAMESPACE.yml"

  printf -- '%s\n' "@ $NAMESPACE" >&2
  ./libexec/m4.sh "$DIR/.m4.env" "$DIR/.env" "$DEFS"
  CONV=("$DENV" -- "$ENV" "$KOMPOSE" convert --stdout --generate-network-policies --namespace "$NAMESPACE" --file "$FILE")
  {
    "${CONV[@]}" | ./libexec/yq.sh --sort-keys --slurp "$JQ" --argjson keel "$KEEL"
    K8S_NAMESPACE="$NAMESPACE" envsubst < "$COMPOSE/networkpolicy.k8s.yml"
  } > "$YAML"
done
printf -- '%s\n' "<<< $DST" >&2
