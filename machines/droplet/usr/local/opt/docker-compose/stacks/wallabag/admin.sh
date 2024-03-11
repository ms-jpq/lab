#!/usr/bin/env -S -- bash -Eeu -O dotglob -O nullglob -O extglob -O failglob -O globstar

set -o pipefail

# https://doc.wallabag.org/en/admin/console_commands
# fos:user:create --super-admin 'username' 'email' 'password'
if (($#)); then
  ARGV=(bin/console --env=prod "$@")
else
  ARGV=(sh)
fi

exec -- docker exec --tty --interactive -- wallabag-srv-1 "${ARGV[@]}"
