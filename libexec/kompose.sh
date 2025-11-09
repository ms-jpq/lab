#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

SRC="$1"
DST="$2"
DEFS="$DST/.env"
shift -- 2

if [[ -v RECURSION ]]; then
  FILE="$1"
  DIR="${FILE%/*}"
  DIRBASE="${DIR##*/}"
  NAMESPACE="kompsed-$DIRBASE"
  TMP="$DST/$NAMESPACE"
  YAML="$TMP.yml"
  KEEL="$(< ./k8s/keel.json)"

  read -r -d '' -- JQ <<- 'JQ' || true
def lens: .spec | .template // .jobTemplate.spec.template;

sort_by(.kind != "Namespace")[]
| (.kind | IN(["DaemonSet", "Deployment", "StatefulSet", "CronJob"][])) as $pods
| if $pods | not then
    .
  else
    .metadata.annotations += $keel
    | (. | lens).spec.initContainers?.[]?.env ?= ((. | lens).spec.containers[].env // [])
    | if ([((. | lens).spec.volumes // [])[].configMap // empty] | length) > 0 then
        (. | lens).metadata.annotations."jq.hash" = $hash
      else
        .
      end
    | if .metadata.annotations."jq.mixin" then
        . as $this
        | ($this | lens).spec |= (. * ($this.metadata.annotations."jq.mixin" | fromjson))
      else
        .
      end
  end
JQ

  FD_INNER=('(' -type f -or -type l ')')
  mkdir -p -- "$TMP"
  RAND_HEX="$(find "$DIR" "${FD_INNER[@]}" -print0 | xargs -0 --no-run-if-empty -- cat -- "./facts/$SRC.k8s.env" | b3sum --length 64 -- | cut -d ' ' -f 1)"
  for F in "$DIR"/*; do
    B="$TMP/${F##*/}"
    case "$F" in
    *.m4*)
      ./libexec/m4.sh "$F" "${B//'.m4'/''}" "$DEFS" -D"ENV_RAND_HEX=$RAND_HEX"
      ;;
    *)
      cp -fr -- "$F" "$B"
      ;;
    esac
  done

  printf -- '%s\n' "@ $NAMESPACE" >&2
  HASHED="$(find "$TMP" "${FD_INNER[@]}" -exec cat -- '{}' + | b3sum --length 32 -- | cut -d ' ' -f 1)"
  FILE_IN="$TMP/docker-compose.yml"
  CONV=(
    ./var/sh/zsh/dev/bin/denv.py
    -- "$TMP/.env"
    ./var/bin/kompose convert
    --stdout
    --generate-network-policies
    --service-group-mode label
    --namespace "$NAMESPACE"
    --file "$FILE_IN"
  )
  {
    "${CONV[@]}" | ./libexec/yq.sh --sort-keys --slurp --arg namespace "$NAMESPACE" --argjson keel "$KEEL" --arg hash "$HASHED" "$JQ"
    cat -- ./k8s/networkpolicy.k8s.yml | K8S_NAMESPACE="$NAMESPACE" envsubst
    ./libexec/yq.sh --sort-keys '(.["x-k8s"] // [])[]' < "$FILE_IN" | COMPOSE_PROJECT_NAME="$NAMESPACE" envsubst
  } > "$YAML"
else

  MACHINE='k8s'
  COMPOSE="./k8s/$SRC"

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

  gmake k8s

  ./libexec/facts.sh "$MACHINE" "./facts/$SRC.k8s".{json,env} > "$DEFS"

  printf -- '%s\n' ">>> $COMPOSE" >&2
  printf -- '%s\0' "${FILES[@]}" | RECURSION=1 xargs -r -0 -I % -P 0 -- "$0" "$SRC" "$DST" %
  printf -- '%s\n' "<<< $DST" >&2
fi
