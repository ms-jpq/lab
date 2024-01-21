#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail
set -x

IOMMU_GROUPS=(
  01:00.0
  01:00.1
)

VENDOR_IDS=(
  '10de 2504'
  '10de 228e'
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

  for SUFFIX in "${IOMMU_GROUPS[@]}"; do
    ID="0000:$SUFFIX"
    OVER="/sys/bus/pci/devices/$ID/driver/unbind"
    if [[ -e "$OVER" ]]; then
      printf -- '%s' "$ID" >"$OVER"
    fi
    printf -- '%s' "$ID" >'/sys/bus/pci/drivers/vfio-pci/bind'
  done

  tree -- /dev/vfio
  ;;
bind)
  exit 1
  ;;
*)
  set -x
  exit 2
  ;;
esac
