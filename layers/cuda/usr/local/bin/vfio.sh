#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

VFIO_LINES="$(lspci -mm | awk '/VGA/ && /NVIDIA/ { print "0000:"$1 }')"
readarray -t -- VFIO_DEVICES <<<"$VFIO_LINES"

VFIO_MODS=(
  vfio
  vfio_iommu_type1
  vfio_pci
)

NVIDIA_MODS=(
  nvidia_drm
)

SERVICES=(
  nvidia-persistenced.service
)

vendor() {
  lspci -n -mm -s "$*" | awk '{ print $3 $4 }' | tr '"' ' ' | awk '{ $1=$1; print }'
}

VFIO_IDS=()

for DEV in "${VFIO_DEVICES[@]}"; do
  for IOMMU in "/sys/bus/pci/devices/$DEV/iommu_group/devices"/*; do
    VFIO_IDS+=("${IOMMU##*/}")
  done
done

case "$1" in
up)
  modprobe -- "${VFIO_MODS[@]}"
  systemctl stop -- "${SERVICES[@]}"
  modprobe -r -- "${NVIDIA_MODS[@]}"

  for IOMMU in "${VFIO_IDS[@]}"; do
    VENDOR="$(vendor "$IOMMU")"
    printf -- '%q -> %q\n' "$IOMMU" "$VENDOR"
    printf -- '%s' "$VENDOR" >"/sys/bus/pci/drivers/nvidia/remove_id" || true
    printf -- '%s' "$IOMMU" >"/sys/bus/pci/devices/$IOMMU/driver/unbind" || true
    printf -- '%s' "$VENDOR" >"/sys/bus/pci/drivers/vfio-pci/new_id" || true
    printf -- '%s' "$IOMMU" >"/sys/bus/pci/drivers/vfio-pci/bind" || true
  done

  tree -- /dev/vfio
  nvidia-smi || true
  printf -- '\n'
  ;;
down)
  for IOMMU in "${VFIO_IDS[@]}"; do
    VENDOR="$(vendor "$IOMMU")"
    printf -- '%q -> %q\n' "$IOMMU" "$VENDOR"
    printf -- '%s' "$VENDOR" >"/sys/bus/pci/drivers/vfio-pci/remove_id" || true
    printf -- '%s' "$IOMMU" >"/sys/bus/pci/drivers/vfio-pci/unbind" || true
    printf -- '%s' "$VENDOR" >"/sys/bus/pci/drivers/nvidia/new_id" || true
    printf -- '%s' "$IOMMU" >"/sys/bus/pci/drivers/nvidia/bind" || true
  done

  tree -- /dev/vfio
  systemctl start -- "${SERVICES[@]}"
  nvidia-smi
  ;;
*)
  set -x
  exit 2
  ;;
esac
