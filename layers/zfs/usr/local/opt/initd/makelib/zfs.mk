.PHONY: user samba iscsi
all: user samba iscsi

CLOBBER.FS += /etc/default/samba

user: /home/ubuntu
/home/ubuntu:
	sudo -- useradd --user-group --create-home -- "$(@F)"

samba: /var/lib/local/samba/usershares

/var/lib/local/samba/usershares: | pkg._
	mkdir -v -p -- '$@'
	sudo -- chgrp -- sambashare '$@'
	sudo -- chmod -- 1770 '$@'

iscsi: /etc/rtslib-fb-target
/etc/rtslib-fb-target: | pkg._
