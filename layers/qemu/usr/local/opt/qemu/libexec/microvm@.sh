#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LONG_OPTS='cpu:,mem:,qmp:,monitor:,console:,bridge:,drive:,macvtap:'
GO="$(getopt --options='' --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

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
  --console)
    CONSOLE="$2"
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

if [[ -z "${CPU:-""}" ]]; then
  NPROCS="$(nproc)"
  CPU="cpus=$((NPROCS / 2))"
fi

ARGV=(
  qemu-system-x86_64-microvm
  -nodefaults
  -no-user-config
  -machine 'microvm,x-option-roms=off,pit=off,pic=off,isa-serial=off,rtc=off,accel=kvm'
  -cpu host
  -smp "$CPU"
  -m "${MEM:-"size=1G"}"
)

ARGV+=(
  -kernel vmlinux
  -append 'reboot=triple'
)

if [[ -n "${CONSOLE:-""}" ]]; then
  ARGV+=(-serial "unix:server=on,wait=off,path=$CONSOLE")
else
  ARGV+=(-serial stdio)
fi

if [[ -n "${QMP:-""}" ]]; then
  ARGV+=(-qmp "unix:$QMP,server,nowait")
fi

if [[ -n "${MONITOR:-""}" ]]; then
  ARGV+=(-monitor "unix:$MONITOR,server,nowait")
fi

NIC='model=virtio-net-device'
ARGV+=(-nic "bridge,br=$BRIDGE,$NIC")

if [[ -n "${MACVTAP:-""}" ]]; then
  ARGV+=(-nic "tap,script=no,downscript=no,ifname=$MACVTAP,$NIC")
fi

for IDX in "${!DRIVES[@]}"; do
  DRIVE="${DRIVES[$IDX]}"
  ID="dri$IDX"
  # TODO io_uring
  ARGV+=(
    -drive "if=none,discard=unmap,format=raw,aio=threads,id=$ID,file=$DRIVE"
    -device "virtio-blk-device,drive=$ID"
  )
done

ARGV+=("$@")

"${0%/*}/pprint.sh" "${ARGV[@]}"
for BIN in "${0%/*}/../apriori.d"/*; do
  if [[ -x "$BIN" ]]; then
    # shellcheck disable=SC2154
    "$BIN" "$MACHINE" "$ROOT"
  fi
done
exec -- "${ARGV[@]}"
