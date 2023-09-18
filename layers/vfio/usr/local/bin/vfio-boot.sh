#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

/usr/local/libexec/hr-run.sh update-initramfs -u
/usr/local/libexec/hr-run.sh update-grub
