#!/usr/bin/env -S -- sed -E -f

s/('LOGFILEDIR', )'[^']*'/\1'\/var\/tmp\/'/
