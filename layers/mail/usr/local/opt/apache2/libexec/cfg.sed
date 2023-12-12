#!/usr/bin/env -S -- sed -E -f

/^ErrorLog.+/d
$aInclude /usr/local/opt/apache2/conf.d/*.conf
