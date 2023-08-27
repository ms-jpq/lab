#!/usr/bin/env -S -- sed -E -f

/^Listen .+:631$/d
s/^(DefaultAuthType) .+$/\1 None/g
