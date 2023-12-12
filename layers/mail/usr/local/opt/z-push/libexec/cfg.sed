#!/usr/bin/env -S -- sed -E -f

s/('LOGBACKEND', )'filelog'/\1'syslog'/
s/('USE_FULLEMAIL_FOR_LOGIN', )false/\1true/
s/('BACKEND_PROVIDER', )''/\1'BackendIMAP'/
