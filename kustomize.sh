#!/usr/bin/env -S -- bash -Eeu -o pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

cd -- "${0%/*}"

SRC="$1"
DST="./var/tmp/k8s/$SRC"
shift -- 1

mkdir -p -- "$DST"
rm -fr -- "${DST:?}"/*

./libexec/kompose.sh "$SRC" "$DST" "$@"
./libexec/charts.sh

if (($#)); then
  PRUNE=()
else
  PRUNE=(--prune --all)
fi

# if ! [[ -v DRY ]]; then
#   cat -- "$DST"/*.yaml | ./libexec/kubectl.sh apply "${PRUNE[@]}" --filename -
# fi
