#!/usr/bin/env -S -- sed -E -f

s/('LOGBACKEND', )'[^']*'/\1'syslog'/
s/('LOGFILEDIR', )'[^']*'/\1'\/var\/tmp\/'/

s/('USE_FULLEMAIL_FOR_LOGIN', )false/\1true/
s/('BACKEND_PROVIDER', )''/\1'BackendIMAP'/
