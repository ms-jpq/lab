#!/usr/bin/env sed -E -f

s/^Listen .+:631$//g
s/^(DefaultAuthType) .+$/\1 None/g
