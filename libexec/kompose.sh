#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

SRC="$1"
DST="./var/tmp/k8s/$SRC"
COMPOSE="var/tmp/machines/$SRC/fs/usr/local/k8s"

gmake MACHINE="$SRC" local
mkdir -v -p -- "$DST"

# Y2J=(yq --output-format json)
# J2Y=(yq --input-format json)

# read -r -d '' -- JQ <<- 'JQ' || true
# JQ

printf -- '%s\n' ">>> $COMPOSE" >&2
for FILE in "$COMPOSE"/*/docker-compose.yml; do
  NAME="${FILE%/*}"
  NAME="${NAME##*/}"
  printf -- '%s\n' "@ $NAME" >&2
  {
    K8S_NAMESPACE="$NAME" envsubst < ./layers/k3s/usr/local/k8s/namespace.k8s.yml
    ./var/bin/kompose convert --stdout --namespace "$NAME" --file "$FILE"
  } > "$DST/$NAME.yml"
done
printf -- '%s\n' "<<< $DST" >&2
