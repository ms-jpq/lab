#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LONG_OPTS='cpu:,mem:,qmp:,monitor:,tpm:,vnc:,bridge:,iscsi:,drive:,macvtap:,vfio:,mdev:'
GO="$(getopt --options='' --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

DRIVES=()
VFIO=()
MDEVS=()
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
  --tpm)
    TPM="$2"
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
  --iscsi)
    INITIATOR_NAME="$2"
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
  --vfio)
    VFIO+=("$2")
    shift -- 2
    ;;
  --mdev)
    MDEVS+=("$2")
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

if [[ -z "${CPU:-""}" ]]; then
  NPROCS="$(nproc)"
  CPU="cpus=$((NPROCS / 2))"
fi

ARGV=(
  qemu-system-x86_64
  -compat 'deprecated-input=crash'
  -nodefaults
  -no-user-config
  -machine 'type=q35,accel=kvm'
  -cpu 'host,hv-passthrough'
  -smp "$CPU"
  -m "${MEM:-"size=8G"}"
)

ARGV+=(
  -bios '/usr/share/ovmf/OVMF.fd'
  -rtc 'base=localtime'
  -device 'intel-iommu,caching-mode=on'
)

ARGV+=(
  -device virtio-rng-pci-non-transitional
  -device 'virtio-balloon-pci-non-transitional,deflate-on-oom=on,free-page-reporting=on'
)

if [[ -n "${QMP:-""}" ]]; then
  ARGV+=(-qmp "unix:$QMP,server,nowait")
fi

if [[ -n "${MONITOR:-""}" ]]; then
  ARGV+=(-monitor "unix:$MONITOR,server,nowait")
fi

if [[ -n "${TPM:-""}" ]]; then
  ID1='chtp0'
  ID2='tpm0'
  ARGV+=(
    -chardev "socket,id=$ID1,path=$TPM"
    -tpmdev "emulator,id=$ID2,chardev=$ID1"
    -device "tpm-tis,tpmdev=$ID2"
  )
fi

if [[ -n "${VNC:-""}" ]]; then
  ARGV+=(
    -display "vnc=unix:$VNC"
    -device "ich9-intel-hda"
    -device 'virtio-gpu-pci'
    -device 'virtio-keyboard-pci'
    -device 'virtio-tablet-pci'
  )
else
  ARGV+=(-nographic)
fi

if [[ -n "${BRIDGE:-""}" ]]; then
  NIC='model=virtio-net-pci-non-transitional'
  ARGV+=(-nic "bridge,br=$BRIDGE,$NIC")
fi

if [[ -n "${MACVTAP:-""}" ]]; then
  ID='mv0'
  SYS="/sys/class/net/$MACVTAP"
  IFI="$(<"$SYS/ifindex")"
  MACADDR="$(<"$SYS/address")"
  exec 3<>"/dev/tap$IFI"
  ARGV+=(-nic "tap,fd=3,mac=$MACADDR,$NIC")
fi

if [[ -n "${INITIATOR_NAME:-""}" ]]; then
  ARGV+=(-iscsi "initiator-name=$INITIATOR_NAME")
fi

for IDX in "${!DRIVES[@]}"; do
  DRIVE="${DRIVES[$IDX]}"
  ID="dri$IDX"
  ARGV+=(
    -drive "if=none,discard=unmap,format=raw,aio=io_uring,id=$ID,file=$DRIVE"
    -device "virtio-blk-pci-non-transitional,drive=$ID"
  )
done

for VF in "${VFIO[@]}"; do
  ARGV+=(-device "vfio-pci,host=$VF")
done

for MDEV in "${MDEVS[@]}"; do
  # display=on,ramfb=on,x-igd-opregion=on,driver=vfio-pci-nohotplug
  ARGV+=(-device "vfio-pci,sysfsdev=$MDEV")
done

ARGV+=("$@")

"${0%/*}/../libexec/pprint.sh" "${ARGV[@]}"
exec -- "${ARGV[@]}"
