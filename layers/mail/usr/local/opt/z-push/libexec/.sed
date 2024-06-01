#!/usr/bin/env -S -- sed -E -f

s/('LOGBACKEND', )'[^']*'/\1'syslog'/
s/('LOGFILEDIR', )'[^']*'/\1'\/var\/tmp\/'/

s/('STATE_DIR', )'[^']*'/\1'\/var\/cache\/local\/z-push\/'/
s/('BACKEND_PROVIDER', )''/\1'BackendIMAP'/
s/('USE_CUSTOM_REMOTE_IP_HEADER', )false/\1'HTTP_X_FORWARDED_FOR'/
