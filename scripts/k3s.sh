#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

OUT='./var/compose'
mkdir -v -p -- "$OUT"

for FILE in ./containers/*/docker-compose.yml; do
  NAME="${FILE%/*}"
  NAME="${NAME##*/}"
  {
    K8S_NAMESPACE="$NAME" envsubst < ./containers/namespace.k8s.yml
    ./var/bin/kompose convert --stdout --file "$FILE"
  } > "$OUT/$NAME.json"
done
