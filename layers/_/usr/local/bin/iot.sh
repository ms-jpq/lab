#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

sysctl -- kernel.task_delayacct=1
iotop --processes --accumulated --fullcmdline --only
