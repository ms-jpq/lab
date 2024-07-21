#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

exec -- ssh -i /var/lib/local/tv/roku.id_ed25519 -- administrator@roku.enp1s0.opnsense.home.arpa pwsh.exe 'D:\Administrator\tv.ps1'
