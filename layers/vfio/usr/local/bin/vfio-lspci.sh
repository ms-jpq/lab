#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

/usr/local/libexec/hr.sh

PREFIX=/sys/kernel/iommu_groups/
for GROUP in "$PREFIX"*; do
  REL="${GROUP##"$PREFIX"}"
  printf -- '%s\n' "$REL"

  for DEVICE in "$GROUP"/devices/*; do
    NAME="${DEVICE##*/}"
    PCI="$(lspci -nn -s "$NAME")"

    printf -- '  %s\n' "$PCI"
  done
done

/usr/local/libexec/hr.sh

# Should see `vfio-pci`
lspci -k
