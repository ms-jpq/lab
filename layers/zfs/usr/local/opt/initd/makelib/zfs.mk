.PHONY: samba iscsi
all: samba iscsi

CLOBBER.FS += /etc/default/samba

samba: /var/lib/local/samba/usershares

/var/lib/local/samba/usershares: | pkg._
	mkdir -v -p -- '$@'
	sudo -- chgrp -- sambashare '$@'
	sudo -- chmod -- 1770 '$@'

iscsi: /etc/rtslib-fb-target
/etc/rtslib-fb-target: | pkg._
