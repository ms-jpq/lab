#!/usr/bin/env -S -- sed -E -f

s/('LOGBACKEND', )'[^']*'/\1'syslog'/
s/('LOGFILEDIR', )'[^']*'/\1'\/var\/tmp\/'/
