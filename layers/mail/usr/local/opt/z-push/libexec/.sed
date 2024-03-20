#!/usr/bin/env -S -- sed -E -f

s/('LOGBACKEND', )'[^']*'/\1'syslog'/
s/('LOGFILEDIR', )'[^']*'/\1'\/var\/tmp\/'/

s/('STATE_DIR', )'[^']*'/\1'\/var\/cache\/local\/z-push\/'/
