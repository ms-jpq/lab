#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}/.."

OUT='./var/compose'
mkdir -v -p -- "$OUT"

Y2J=(yq --output-format json)
J2Y=(yq --input-format json)

# shellcheck disable=SC2016
MOD=(jq '.metadata.namespace = $name')

for FILE in ./containers/*/docker-compose.yml; do
  NAME="${FILE%/*}"
  NAME="${NAME##*/}"
  {
    K8S_NAMESPACE="$NAME" envsubst < ./containers/namespace.k8s.yml
    ./var/bin/kompose convert --stdout --file "$FILE" | "${Y2J[@]}" | "${MOD[@]}" --arg name "$NAME" | "${J2Y[@]}"
  } > "$OUT/$NAME.yml"
done
