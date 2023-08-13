#!/usr/bin/env -S -- jq --exit-status --from-file

(.[$machine] // {}) as $inventory
| ($inventory.hosts // [$host]) as $hosts
| ($inventory.port // $port) as $p
| { hosts: $hosts, port: $p }
