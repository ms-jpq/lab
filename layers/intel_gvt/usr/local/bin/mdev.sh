#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

SYSFS='/sys/bus/mdev/devices'

NAME="$2"
UUID="$(uuidgen --namespace @dns --sha1 --name "$NAME")"
case "$1" in
up)
  MDEV_LINES="$(lspci -mm | awk '/VGA/ && /Intel/ { print "0000:"$1 }')"
  readarray -t -- MDEV_IDS <<<"$MDEV_LINES"

  MDEV_MODS=(
    kvmgt
    mdev
    vfio-iommu-type1
  )

  modprobe -- "${MDEV_MODS[@]}"

  for IOMMU in "${MDEV_IDS[@]}"; do
    for TYPE in "/sys/bus/pci/devices/$IOMMU/mdev_supported_types"/*; do
      INSTANCES="$(<"$TYPE/available_instances")"
      if ((INSTANCES)); then
        printf -- '%s' "$UUID" >"$TYPE/create"
        printf -- '%s' "$SYSFS/$UUID"
        if [[ -t 1 ]]; then
          printf -- '\n' >&2
        fi
        exit
      fi
    done
  done

  exit 1
  ;;
down)
  printf -- '%s' 1 >"$SYSFS/$UUID/remove"
  ;;
*)
  set -x
  exit 2
  ;;
esac
