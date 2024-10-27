#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

SRC="$1"
DST="./var/tmp/k8s/$SRC"
mkdir -v -p -- "$DST"
gmake MACHINE="$SRC" local

# Y2J=(yq --output-format json)
# J2Y=(yq --input-format json)

# read -r -d '' -- JQ <<- 'JQ' || true
# JQ

for FILE in "var/tmp/machines/$SRC/fs/usr/local/k8s"/*/docker-compose.yml; do
  NAME="${FILE%/*}"
  NAME="${NAME##*/}"
  printf -- '%s\n' "@ $NAME" >&2
  {
    K8S_NAMESPACE="$NAME" envsubst < ./layers/k3s/usr/local/k8s/namespace.k8s.yml
    ./var/bin/kompose convert --stdout --namespace "$NAME" --file "$FILE"
  } > "$DST/$NAME.yml"
done
printf -- '%s\n' ">>> $DST" >&2
