#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

LONG_OPTS='cpu:,mem:,qmp:,monitor:,console:,bridge:,kernel:,initrd:,drive:,root:,macvtap:'
GO="$(getopt --options='' --longoptions="$LONG_OPTS" --name="$0" -- "$@")"
eval -- set -- "$GO"

DRIVES=()
TAPS=()
while (($#)); do
  case "$1" in
  --cpu)
    CPUS="$2"
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
  --macvtap)
    TAPS+=("$2")
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

if [[ -z "${CPUS:-""}" ]]; then
  NPROCS="$(nproc)"
  CPUS="cpus=$((NPROCS / 2))"
fi

ARGV=(
  qemu-system-x86_64-microvm
)

if [[ -n "${PIDFILE:-""}" ]]; then
  ARGV+=(
    -pidfile "$PIDFILE"
    -daemonize
  )
fi

ARGV+=(
  -compat 'deprecated-input=crash'
  -nodefaults
  -no-user-config
  -nographic
  -machine 'microvm,x-option-roms=off,pit=off,pic=off,isa-serial=off,rtc=off,accel=kvm'
  -cpu host
  -smp "$CPUS"
  -m "${MEM:-"size=1G"}"
)

KERNEL_COMMANDS=(
  reboot=triple
  panic=-1
  random.trust_cpu=on
  random.trust_bootloader=on
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

if [[ -n "${BRIDGE:-""}" ]]; then
  ID='br0'
  ARGV+=(
    -netdev "bridge,id=$ID,br=$BRIDGE"
    -device "virtio-net-device,netdev=$ID"
  )
fi

FD=3
for IDX in "${!TAPS[@]}"; do
  ID="mv$IDX"
  MACVTAP="${TAPS[$IDX]}"
  SYS="/sys/class/net/$MACVTAP"
  IFI="$(<"$SYS/ifindex")"
  MACADDR="$(<"$SYS/address")"
  exec {FD}<>"/dev/tap$IFI"
  ARGV+=(
    -netdev "tap,fd=$FD,id=$ID"
    -device "virtio-net-device,netdev=$ID,mac=$MACADDR"
  )
  ((FD++))
done

for IDX in "${!DRIVES[@]}"; do
  ID="dri$IDX"
  DRIVE="${DRIVES[$IDX]}"
  # TODO io_uring
  ARGV+=(
    -drive "if=none,format=raw,aio=threads,cache=none,id=$ID,file=$DRIVE"
    -device "virtio-blk-device,drive=$ID"
  )
done

ARGV+=("$@")

"${0%/*}/../libexec/pprint.sh" "${ARGV[@]}"
exec -- "${ARGV[@]}"
