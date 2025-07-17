#!/usr/bin/env -S -- sed -E -f
/ /d
1i\

s#\.#\\.#g
s#(^.*$)#    -  ^([^.]+\.)*\1$#g
