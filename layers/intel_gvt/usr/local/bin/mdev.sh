#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

MDEV_LINES="$(lspci -mm | awk '/VGA/ && /Intel/ { print "0000:"$1 }')"
readarray -t -- MDEV_IDS <<<"$MDEV_LINES"

MDEV_MODS=(
  kvmgt
  mdev
  vfio-iommu-type1
)

UUID="$2"
case "$1" in
up)
  modprobe -- "${MDEV_MODS[@]}"

  for IOMMU in "${MDEV_IDS[@]}"; do
    printf -- '%s\n' "/sys/bus/pci/devices/$IOMMU/mdev_supported_types"/*
  done
  ;;
down)
  for IOMMU in "${MDEV_IDS[@]}"; do
    printf -- '%s\n' "/sys/bus/pci/devices/$IOMMU/mdev_supported_types"/*
  done
  ;;
*)
  set -x
  exit 2
  ;;
esac

printf -- '%s\n' "$UUID"
