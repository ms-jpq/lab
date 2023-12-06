#!/usr/bin/env -S -- sed -E -f

/^[[:space:]]+chroot.+/d
/^[[:space:]]+option[[:space:]]+httplog/d
