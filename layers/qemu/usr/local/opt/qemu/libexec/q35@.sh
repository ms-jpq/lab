#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O globstar

set -o pipefail

DRIVE="$1"
DIR="${DRIVE%/*}"

shift -- 1

GB=$((2 << 30))
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

ARGV=("$@")
if ((USAGE < GB)); then
  for ISO in /var/cache/local/qemu/*.iso; do
    ARGV+=(--disc "$ISO")
  done
fi

exec -- "${0%/*}/../bin/q35.sh" "${ARGV[@]}"
