#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LONG_OPTS='cpu:,mem:,qmp:,monitor:,tpm:,vnc:,bridge:,iscsi:,drive:,macvtap:,vfio:,mdev:,disc:'
GO="$(getopt --options='' --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

TAPS=()
DRIVES=()
VFIO=()
MDEVS=()
CDS=()
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
    TAPS+=("$2")
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
  --disc)
    CDS+=("$2")
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
  -machine 'type=q35,smm=on,accel=kvm'
  -cpu 'max,hv-passthrough'
  -smp "$CPU"
  -m "${MEM:-"size=8G"}"
)

ARGV+=(
  -bios '/usr/share/ovmf/OVMF.fd'
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

ARGV+=(
  -device 'virtio-keyboard-pci'
  -device 'virtio-tablet-pci'
)

if [[ -n "${VNC:-""}" ]]; then
  ARGV+=(
    -display "vnc=unix:$VNC"
    -vga 'virtio'
    # TODO: qemu new version
    # -audio 'driver=none,model=hda'
    -soundhw 'hda'
  )
else
  ARGV+=(-nographic)
fi

NIC='model=virtio-net-pci-non-transitional'
if [[ -n "${BRIDGE:-""}" ]]; then
  ARGV+=(-nic "bridge,$NIC,br=$BRIDGE")
fi

for MACVTAP in "${TAPS[@]}"; do
  SYS="/sys/class/net/$MACVTAP"
  IFI="$(<"$SYS/ifindex")"
  MACADDR="$(<"$SYS/address")"
  exec 3<>"/dev/tap$IFI"
  ARGV+=(-nic "tap,fd=3,$NIC,mac=$MACADDR")
done

if [[ -n "${INITIATOR_NAME:-""}" ]]; then
  ARGV+=(-iscsi "initiator-name=$INITIATOR_NAME")
fi

for IDX in "${!DRIVES[@]}"; do
  DRIVE="${DRIVES[$IDX]}"
  ID="dri$IDX"
  ARGV+=(
    -drive "if=none,format=raw,aio=io_uring,cache=none,id=$ID,file=$DRIVE"
    -device "virtio-blk-pci-non-transitional,drive=$ID"
  )
done

for CD in "${CDS[@]}"; do
  ARGV+=(-drive "if=ide,media=cdrom,file=$CD")
done

for VF in "${VFIO[@]}"; do
  ARGV+=(-device "vfio-pci-nohotplug,host=$VF")
done

ARGV+=(-device 'intel-iommu,caching-mode=on')

for MDEV in "${MDEVS[@]}"; do
  # display=on,ramfb=on,x-igd-opregion=on
  ARGV+=(-device "vfio-pci-nohotplug,sysfsdev=$MDEV")
done

ARGV+=("$@")

"${0%/*}/../libexec/pprint.sh" "${ARGV[@]}"
exec -- "${ARGV[@]}"
