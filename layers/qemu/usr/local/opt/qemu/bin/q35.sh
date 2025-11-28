#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

# TODO: smbios
LONG_OPTS='name:,cpu:,cpu-flags:,mem:,qmp:,monitor:,boot:,tpm:,vnc:,bridge:,iscsi:,drive:,macvtap:,usb:,vfio:,mdev:,disc:'
GO="$(getopt --options='' --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

NAME="$(uuidgen)"
CPU_FLAGS=()
TAPS=()
DRIVES=()
USBS=()
VFIO=()
MDEVS=()
CDS=()
while (($#)); do
  case "$1" in
  --name)
    NAME="$2"
    shift -- 2
    ;;
  --cpu)
    CPUS="$2"
    shift -- 2
    ;;
  --cpu-flags)
    if [[ -n $2 ]]; then
      CPU_FLAGS+=("$2")
    fi
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
  --boot)
    case "${2,,}" in
    uefi)
      BIOS='/usr/share/ovmf/OVMF.fd'
      ;;
    bios)
      BIOS='/usr/share/seabios/bios.bin'
      ;;
    '' | /*)
      BIOS="$2"
      ;;
    *)
      set -x
      exit 1
      ;;
    esac
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
  --usb)
    USBS+=("$2")
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

if [[ -z ${CPUS:-""} ]]; then
  NPROCS="$(nproc)"
  CPUS="cpus=$((NPROCS / 2))"
fi

FEATS=(
  host
  host-phys-bits=on
  hv-passthrough=on
  migratable=off
  "${CPU_FLAGS[@]}"
)

IFS=','
CPUF="${FEATS[*]}"
unset -- IFS

ARGV=(
  qemu-system-x86_64
  -name "$NAME,debug-threads=on"
)

if [[ -n ${PIDFILE:-""} ]]; then
  ARGV+=(
    -pidfile "$PIDFILE"
    -daemonize
  )
fi

ARGV+=(
  -compat 'deprecated-input=crash'
  -nodefaults
  -no-user-config
  -machine 'type=q35,smm=on,accel=kvm,kernel-irqchip=split'
  -cpu "$CPUF"
  -smp "$CPUS"
  -m "${MEM:-"size=8G"}"
)

if [[ -n ${BIOS:-""} ]]; then
  ARGV+=(-bios "$BIOS")
fi

ARGV+=(
  -device 'virtio-rng-pci-non-transitional'
  # Windows Sucks
  # -device 'virtio-balloon-pci-non-transitional,deflate-on-oom=on,free-page-reporting=on'
)

if [[ -n ${QMP:-""} ]]; then
  ARGV+=(-qmp "unix:$QMP,server,nowait")
fi

if [[ -n ${MONITOR:-""} ]]; then
  ARGV+=(-monitor "unix:$MONITOR,server,nowait")
fi

if [[ -n ${TPM:-""} ]]; then
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

if [[ -n ${VNC:-""} ]]; then
  AUD='aud0'
  ARGV+=(
    -display "vnc=unix:$VNC"
    -device 'virtio-vga'
    -device "virtio-sound-pci,audiodev=$AUD"
    -audiodev "driver=none,id=$AUD"
  )
else
  ARGV+=(-nographic)
fi

NIC='model=virtio-net-pci-non-transitional'
if [[ -n ${BRIDGE:-""} ]]; then
  ARGV+=(-nic "bridge,$NIC,br=$BRIDGE")
fi

FD=3
for MACVTAP in "${TAPS[@]}"; do
  SYS="/sys/class/net/$MACVTAP"
  IFI="$(< "$SYS/ifindex")"
  MACADDR="$(< "$SYS/address")"
  exec {FD}<> "/dev/tap$IFI"
  ARGV+=(-nic "tap,fd=$FD,$NIC,mac=$MACADDR")
  ((FD++))
done

if [[ -n ${INITIATOR_NAME:-""} ]]; then
  ARGV+=(-iscsi "initiator-name=$INITIATOR_NAME")
fi

BLKDEV_OPTIONS=(
  raw
  file.aio=io_uring
  cache.direct=on
)
printf -v BLKOPTS -- '%s,' "${BLKDEV_OPTIONS[@]}"
for IDX in "${!DRIVES[@]}"; do
  DRIVE="${DRIVES[$IDX]}"
  ID="blk$IDX"
  if [[ -b $DRIVE ]]; then
    DRIVER='host_device'
  else
    DRIVER='file'
  fi
  ARGV+=(
    -blockdev "${BLKOPTS}file.driver=$DRIVER,node-name=$ID,file.filename=$DRIVE"
    -device "virtio-blk-pci-non-transitional,drive=$ID"
  )
done

for IDX in "${!CDS[@]}"; do
  CD="${CDS[$IDX]}"
  ID="cd$IDX"
  ARGV+=(
    -blockdev "${BLKOPTS}file.driver=file,read-only=on,node-name=$ID,file.filename=$CD"
    -device "virtio-blk-pci-non-transitional,drive=$ID"
  )
done

if ((${#USBS[@]})); then
  ARGV+=(-usb)
  for USB in "${USBS[@]}"; do
    ARGV+=(-device "$USB")
  done
fi

for VF in "${VFIO[@]}"; do
  ARGV+=(-device "vfio-pci-nohotplug,host=$VF")
done

for MDEV in "${MDEVS[@]}"; do
  # display=on,ramfb=on,x-igd-opregion=on
  ARGV+=(-device "vfio-pci-nohotplug,sysfsdev=$MDEV")
done

ARGV+=("$@")

"${0%/*}/../libexec/pprint.sh" "${ARGV[@]}"
exec -- "${ARGV[@]}"
