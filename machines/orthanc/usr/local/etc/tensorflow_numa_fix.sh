#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

PCI="$(lspci -mm | awk '/VGA/ && /NVIDIA/ { print "0000:"$1 }')"

NODE="/sys/bus/pci/devices/$PCI/numa_node"
printf -- '%s' 0 >"$NODE"
