#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

cd -- "${0%/*}/.."

SRC="$1"
DST="$2"
shift -- 2

MACHINE='k8s'
COMPOSE="./k8s/$SRC"
DENV='./var/sh/zsh/dev/bin/denv.py'

if (($#)); then
  FILES=()
  for F in "$COMPOSE/$*"/docker-compose.{yml,m4.yml}; do
    if [[ -s $F ]]; then
      FILES+=("$F")
    fi
  done
else
  FILES=("$COMPOSE"/*/docker-compose.{yml,m4.yml})
fi

read -r -d '' -- JQ <<- 'JQ' || true
sort_by(.kind != "Namespace")[]
| (.kind | IN(["DaemonSet", "Deployment", "StatefulSet"][])) as $pods
| if $pods then
    .metadata.annotations += $keel
    | .spec.template.spec.initContainers?.[]?.env ?= (.spec.template.spec.containers[].env // [])
  else
    .
  end
| if $pods and ([(.spec.template.spec.volumes // [])[].configMap // empty] | length) > 0 then
    .spec.template.metadata.annotations."jq.hash" = $hash
  else
    .
  end
| if $pods and .metadata.annotations."jq.runtime" then
    .spec.template.spec.runtimeClassName = .metadata.annotations."jq.runtime"
  else
    .
  end
JQ
KEEL="$(< ./k8s/keel.json)"

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
      RAND_HEX="$(cat -- "./facts/$SRC.k8s.env" "$F" | b3sum --length 64 -- | cut -d ' ' -f 1)"
      RAND_HEX="$RAND_HEX" ./libexec/m4.sh "$F" "${B//'.m4'/''}" "$DEFS"
      ;;
    *)
      cp -fr -- "$F" "$B"
      ;;
    esac
  done

  printf -- '%s\n' "@ $NAMESPACE" >&2
  HASHED="$(cat -- "$TMP"/* | b3sum --length 32 -- | cut -d ' ' -f 1)"
  FILE_IN="$TMP/docker-compose.yml"
  CONV=("$DENV" -- "$TMP/.env" ./var/bin/kompose convert --stdout --generate-network-policies --namespace "$NAMESPACE" --file "$FILE_IN")
  {
    "${CONV[@]}" | ./libexec/yq.sh --sort-keys --slurp --argjson keel "$KEEL" --arg hash "$HASHED" "$JQ"
    K8S_NAMESPACE="$NAMESPACE" envsubst < ./k8s/networkpolicy.k8s.yml
    ./libexec/yq.sh --sort-keys '(.["x-k8s"] // [])[]' < "$FILE_IN" | COMPOSE_PROJECT_NAME="$NAMESPACE" envsubst
  } > "$YAML"
done
printf -- '%s\n' "<<< $DST" >&2
