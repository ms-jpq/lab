#!/usr/bin/env -S -- jq --exit-status --from-file

.[$machine] as $conn
| { host: ($conn.hosts // $host // "0.0.0.0"),
    port: ($conn.port // $port // 22),
    user: ($conn.user // $user // "root") }
