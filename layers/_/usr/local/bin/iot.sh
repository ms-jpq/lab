#!/usr/bin/env -S -- bash -Eeuo pipefail -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

sysctl -- kernel.task_delayacct=1
exec -- iotop --processes --accumulated --fullcmdline --only "$@"
