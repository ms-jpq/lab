#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
shopt -u failglob

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
if [[ -z ${ARGV:-""} ]] && ((USAGE < (10 ** 8))); then
  TMP="$(mktemp)"
  FIND=(find /var/cache/local/qemu -type f -name '*.iso' -exec stat --printf '%s %n\0' -- '{}' ';')
  SORT=(sort --zero-terminated --reverse --numeric-sort --key '1,1')
  CUT=(cut --zero-terminated --delimiter ' ' --fields 2-)
  "${FIND[@]}" | "${SORT[@]}" | "${CUT[@]}" > "$TMP"
  readarray -t -d '' -- ISOS < "$TMP"
  rm -fr -- "$TMP"
  for ISO in "${ISOS[@]}"; do
    ARGZ+=(--disc "$ISO")
  done
fi

exec -- "${0%/*}/../bin/q35.sh" "${ARGZ[@]}"
