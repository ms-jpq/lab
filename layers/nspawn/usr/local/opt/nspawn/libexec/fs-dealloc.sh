#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

ROOT="$1"
shift -- 1

if ! (($#)); then
  exit 1
fi

HR='/usr/local/libexec/hr-run.sh'
set -x

if ! [[ -e "$ROOT" ]]; then
  exit 0
fi

FS="$(stat --file-system --format %T -- "$ROOT")"
case "$FS" in
tmpfs)
  while true; do
    ZVOl="$(readlink -- "$ROOT")"
    if [[ "$ZVOL" =~ ^/dev/zvol ]]; then
      ZVOL="${ZVOl#/dev/zvol/}"
      break
    fi
  done
  "$HR" zfs destroy -v -r -- "$ZVOL"
  ;;
zfs)
  ZFS="$(findmnt --noheadings --output source --target "$ROOT")"
  MOUNT="$(zfs get -H -o value -- mountpoint "$ZFS")"
  case "$MOUNT" in
  '' | '-' | legacy)
    set -x
    printf -- '%q\n' "$ZFS - $MOUNT" >&2
    exit 1
    ;;
  *) ;;
  esac

  for SAFE in "$@"; do
    if [[ "$MOUNT" == "${SAFE%'/'}" ]]; then
      set -x
      exit 1
    fi
  done

  "$HR" zfs destroy -v -r -- "$ZFS"
  ;;
btrfs)
  "$HR" btrfs subvolume delete -- "$ROOT"
  ;;
*) ;;
esac
"$HR" rm -v -fr -- "$ROOT"
