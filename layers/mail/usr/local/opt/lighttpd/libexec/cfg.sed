#!/usr/bin/env -S -- sed -E -f

/^server\.port.+/d
/^server\.errorlog.+/d
/^server\.upload-dirs/d
/^include.+/d
$ainclude "/usr/local/opt/lighttpd/conf.d/*.conf"
