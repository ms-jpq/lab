#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

cd -- "${0%/*}/.."

SRC="$1"
DST="$2"
shift -- 2

MACHINE='k8s'
COMPOSE="./$MACHINE"
DENV='./var/sh/zsh/dev/bin/denv.py'

YML='docker-compose.yml'
if (($#)); then
  FILES=("$COMPOSE/$*"/"$YML")
else
  FILES=("$COMPOSE"/*/"$YML")
fi

read -r -d '' -- JQ <<- 'JQ' || true
sort_by(.kind != "Namespace")[]
| if (.kind | IN(["Deployment", "StatefulSet"][])) then
    .metadata.annotations += $keel
    | .spec.template.metadata.annotations += $keel
    | .spec.template.spec.initContainers?.[]?.env ?= (.spec.template.spec.containers[].env // [])
  else
    .
  end
JQ
KEEL="$(< "$COMPOSE/keel.json")"

gmake k8s

DEFS="$DST/.env"
./libexec/facts.sh "$MACHINE" "./facts/$SRC.k8s".{env,json} > "$DEFS"

printf -- '%s\n' ">>> $COMPOSE" >&2
for FILE in "${FILES[@]}"; do
  DIR="${FILE%/*}"
  DIRBASE="${DIR##*/}"
  NAMESPACE="kompsed-$DIRBASE"
  TMP="$DST/$NAMESPACE"
  YAML="$TMP.yml"

  mkdir -p -- "$TMP"
  for F in "$DIR"/*; do
    B="$TMP/${F##*/}"
    case "$F" in
    *.m4*)
      ./libexec/m4.sh "$F" "${B//'.m4'/''}" "$DEFS"
      ;;
    *)
      cp -fr -- "$F" "$B"
      ;;
    esac
  done

  printf -- '%s\n' "@ $NAMESPACE" >&2
  CONV=("$DENV" -- "$TMP/.env" ./var/bin/kompose convert --stdout --generate-network-policies --namespace "$NAMESPACE" --file "$TMP/$YML")
  {
    "${CONV[@]}" | ./libexec/yq.sh --sort-keys --slurp "$JQ" --argjson keel "$KEEL"
    K8S_NAMESPACE="$NAMESPACE" envsubst < "$COMPOSE/networkpolicy.k8s.yml"
  } > "$YAML"
done
printf -- '%s\n' "<<< $DST" >&2
