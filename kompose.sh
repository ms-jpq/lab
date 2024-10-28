#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

SRC="$1"
DST="./var/tmp/k8s/$SRC"
COMPOSE="./var/tmp/machines/$SRC/fs/usr/local/k8s"
KOMPOSE='var/bin/kompose'
DENV='./var/sh/zsh/dev/bin/denv.py'

gmake "$KOMPOSE"
gmake MACHINE="$SRC" local
rm -fr -- "$DST"
mkdir -p -- "$DST"

Y2J=(yq --output-format json)
J2Y=(yq --input-format json '(.. | select(tag == "!!str")) style="single"')

read -r -d '' -- JQ <<- 'JQ' || true
sort_by(.kind != "Namespace")[]
JQ

printf -- '%s\n' ">>> $COMPOSE" >&2
for FILE in "$COMPOSE"/*/docker-compose.yml; do
  DIR="${FILE%/*}"
  NAMESPACE="${DIR##*/}"
  ENV="$DIR/.env"

  printf -- '%s\n' "@ $NAMESPACE" >&2
  touch -- "$ENV"
  CONV=("$DENV" -- "$ENV" "$KOMPOSE" convert --stdout --generate-network-policies --namespace "$NAMESPACE" --file "$FILE")
  {
    "${CONV[@]}" | "${Y2J[@]}" | jq --slurp "$JQ" | "${J2Y[@]}"
    NAMESPACE="$NAMESPACE" envsubst < './layers/k3s/usr/local/k8s/networkpolicy.k8s.yml'
  } > "$DST/$NAMESPACE.yml"
done
printf -- '%s\n' "<<< $DST" >&2
