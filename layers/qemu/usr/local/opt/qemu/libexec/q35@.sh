#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

DRIVE="$1"
DIR="${DRIVE%/*}"

shift -- 1

FS="$(stat --file-system --format %T -- "$DIR")"
case "$FS" in
zfs)
  ZVOl="$(readlink -- "$DRIVE")"
  ZVOL="${ZVOl#/dev/zvol/}"
  USAGE="$(zfs get -H -p -o value -- logicalreferenced "$ZVOL")"
  ;;
*)
  USAGE="$(qemu-img info -f raw --output json -- "$DRIVE" | jq --exit-status --raw-output '.["actual-size"]')"
  ;;
esac

ARGZ=("$@")
if [[ -z "${ARGV:-""}" ]] && ((USAGE < (10 ** 8))); then
  FIND=(find /var/cache/local/qemu -type f -name '*.iso' -exec stat --printf '%s %n\0' -- '{}' ';')
  SORT=(sort --zero-terminated --reverse --numeric-sort --key '1,1')
  CUT=(cut --zero-terminated --delimiter ' ' --fields 2)
  "${FIND[@]}" | "${SORT[@]}" | "${CUT[@]}" | while IFS= read -r -d '' -- ISO; do
    ARGZ+=(--disc "$ISO")
  done
fi

exec -- "${0%/*}/../bin/q35.sh" "${ARGZ[@]}"
