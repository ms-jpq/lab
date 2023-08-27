.PHONY: user samba iscsi clobber.samba clobber.iscsi
all: user samba iscsi

CLOBBER.FS += /etc/default/samba
CLOBBER.FS += /etc/rtslib-fb-target

user: /home/ubuntu
/home/ubuntu:
	sudo -- useradd --user-group --create-home -- "$(@F)"

samba: /var/lib/local/samba/usershares

/var/lib/local/samba/usershares: | pkg._
	sudo -- mkdir -v -p -- '$@'
	sudo -- chgrp -- sambashare '$@'
	sudo -- chmod -- 1770 '$@'
	sudo -- /usr/local/opt/samba/libexec/share.sh

iscsi: /etc/rtslib-fb-target
/etc/rtslib-fb-target: | pkg._
	sudo -- /usr/local/opt/iscsi/libexec/share.sh

clobber.iscsi:
	sudo -- /usr/local/opt/iscsi/libexec/unshare.sh

