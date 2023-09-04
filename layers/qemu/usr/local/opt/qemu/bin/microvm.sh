#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LONG_OPTS='cpu:,mem:,qmp:,monitor:,console:,tap:,kernel:,initrd:,drive:,root:'
GO="$(getopt --options='' --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

TAPS=()
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
  --tap)
    TAPS+=("$2")
    shift -- 2
    ;;
  --kernel)
    KERNEL="$2"
    shift -- 2
    ;;
  --initrd)
    INITRD="$2"
    shift -- 2
    ;;
  --drive)
    DRIVES+=("$2")
    shift -- 2
    ;;
  --root)
    ROOT="$2"
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
  -nographic
  -machine 'microvm,x-option-roms=off,pit=off,pic=off,isa-serial=off,rtc=off,accel=kvm'
  -cpu host
  -smp "$CPU"
  -m "${MEM:-"size=1G"}"
)

KERNEL_COMMANDS=(
  reboot=triple
  panic=-1
  console=hvc0
  "root=$ROOT"
)

CON='con0'
ARGV+=(
  -kernel "$KERNEL"
  -initrd "$INITRD"
  -append "${KERNEL_COMMANDS[*]}"
  -device 'virtio-serial-device'
  -device "virtconsole,chardev=$CON"
)

if [[ -n "${CONSOLE:-""}" ]]; then
  ARGV+=(-chardev "socket,server=on,wait=off,id=$CON,path=$CONSOLE")
else
  ARGV+=(-chardev "stdio,id=$CON")
fi

ARGV+=(-device virtio-rng-device)

if [[ -n "${QMP:-""}" ]]; then
  ARGV+=(-qmp "unix:$QMP,server,nowait")
fi

if [[ -n "${MONITOR:-""}" ]]; then
  ARGV+=(-monitor "unix:$MONITOR,server,nowait")
fi

for IDX in "${!TAPS[@]}"; do
  ID="tap$IDX"
  TAP="${TAPS[$IDX]}"
  ARGV+=(
    -netdev "tap,script=no,downscript=no,id=$ID,ifname=$TAP"
    -device "virtio-net-device,netdev=$ID"
  )
done

for IDX in "${!DRIVES[@]}"; do
  ID="dri$IDX"
  DRIVE="${DRIVES[$IDX]}"
  if ! ((IDX)); then
    DRIVE=/var/cache/local/qemu/cloudimg.raw
  fi
  # TODO io_uring
  ARGV+=(
    -drive "if=none,discard=unmap,format=raw,aio=threads,id=$ID,file=$DRIVE"
    -device "virtio-blk-device,drive=$ID"
  )
done

ARGV+=("$@")

"${0%/*}/../libexec/pprint.sh" "${ARGV[@]}"
exec -- "${ARGV[@]}"
