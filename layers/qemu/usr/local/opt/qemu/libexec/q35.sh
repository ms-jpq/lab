#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LONG_OPTS='cpu:,mem:,qmp:,monitor:,vnc:,bridge:,drive:,macvtap:'
GO="$(getopt --options='' --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

# shellcheck disable=SC1091
source -- /etc/iscsi/initiatorname.iscsi

DRIVES=()
while (($#)); do
  case "$1" in
  --cpu)
    CPU="$2"
    shift -- 2
    ;;
  --mem)
    MEM="$2"
    shift -- 2
    ;;
  --qmp)
    QMP="$2"
    shift -- 2
    ;;
  --monitor)
    MONITOR="$2"
    shift -- 2
    ;;
  --vnc)
    VNC="$2"
    shift -- 2
    ;;
  --bridge)
    BRIDGE="$2"
    shift -- 2
    ;;
  --drive)
    DRIVES+=("$2")
    shift -- 2
    ;;
  --macvtap)
    MACVTAP="$2"
    shift -- 2
    ;;
  --)
    shift -- 1
    break
    ;;
  *)
    exit 1
    ;;
  esac
done

if ! [[ -v CPU ]]; then
  NPROCS="$(nproc)"
  CPU="cpus=$((NPROCS / 2))"
fi

ARGV=(
  qemu-system-x86
  -nodefaults
  -no-user-config
  -machine 'type=q35,accel=kvm'
  -cpu 'host,hv-passthrough'
  -smp "$CPU"
  -m "${MEM:-"size=8G"}"
)

ARGV+=(
  -bios '/usr/share/qemu/OVMF.fd'
  -rtc 'base=localtime'
  -device 'intel-iommu,caching-mode=on'
)

ARGV+=(
  -device virtio-rng-pci-non-transitional
  -device virtio-balloon-pci-non-transitional
)

if [[ -v QMP ]]; then
  ARGV+=(-qmp "unix:$QMP,server,nowait")
fi

if [[ -v MONITOR ]]; then
  ARGV+=(-monitor "unix:$MONITOR,server,nowait")
fi

ARGV+=(
  -vnc "$VNC"
  -device "ich9-intel-hda"
  -device 'virtio-gpu-pci'
  -device 'virtio-keyboard-pci'
  -device 'virtio-tablet-pci'
)

NIC='model=virtio-net-pci-non-transitional'
ARGV+=(-nic "bridge,br=$BRIDGE,$NIC")

if [[ -v MACVTAP ]]; then
  ARGV+=(-nic "tap,script=no,downscript=no,ifname=$MACVTAP,$NIC")
fi

if [[ -v InitiatorName ]]; then
  ARGV+=(-iscsi "$InitiatorName")
fi

for IDX in "${!DRIVES[@]}"; do
  DRIVE="${DRIVES[$IDX]}"
  ID="dri$IDX"
  ARGV+=(
    -drive "if=none,discard=unmap,format=raw,aio=io_uring,id=$ID,file=$DRIVE"
    -device "virtio-blk-pci-non-transitional,drive=$ID"
  )
done

ARGV+=("$@")

"${0%/*}/pprint.sh" "${ARGV[@]}"
