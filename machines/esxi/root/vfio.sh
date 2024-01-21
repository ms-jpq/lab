#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
set -x

VFIO_IDS=(
  '01:00.0=10de 2504'
  '01:00.1=10de 228e'
)

MODS=(
  vfio
  vfio_iommu_type1
  vfio_pci
)

case "$1" in
unbind)
  for MOD in "${MODS[@]}"; do
    modprobe -- "$MOD"
  done

  systemctl stop -- nvidia-persistenced.service

  for VF in "${VFIO_IDS[@]}"; do
    IOMMU="0000:${VF%=*}"
    VENDOR="${VF#*=}"
    printf -- '%s' "$IOMMU" >"/sys/bus/pci/devices/$IOMMU/driver/unbind" || true
    printf -- '%s' "$VENDOR" >"/sys/bus/pci/drivers/vfio-pci/new_id" || true
  done

  tree -- /dev/vfio
  ;;
bind)
  for VF in "${VFIO_IDS[@]}"; do
    IOMMU="0000:${VF%=*}"
    VENDOR="${VF#*=}"
    printf -- '%s' "$VENDOR" >"/sys/bus/pci/drivers/vfio-pci/remove_id" || true
    printf -- '%s' "$IOMMU" >"/sys/bus/pci/devices/$IOMMU/driver/bind" || true
  done

  tree -- /dev/vfio

  systemctl start -- nvidia-persistenced.service
  ;;
*)
  set -x
  exit 2
  ;;
esac
