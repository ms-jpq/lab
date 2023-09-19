.PHONY: user samba iscsi clobber.samba clobber.iscsi

all: user samba iscsi

CLOBBER.FS += /etc/default/samba /var/lib/local/samba/usershares
CLOBBER.FS += /etc/rtslib-fb-target

pkg._: | /home/ubuntu
user: /home/ubuntu
/home/ubuntu:
	sudo -- useradd --user-group --create-home -- "$(@F)"

samba: /var/lib/local/samba/usershares

/var/lib/local/samba/usershares: | pkg._
	sudo -- mkdir -v -p -- '$@'
	sudo -- chgrp -- sambashare '$@'
	sudo -- chmod -- 1770 '$@'
	sudo --preserve-env -- /usr/local/opt/samba/libexec/share.sh

iscsi: /etc/rtslib-fb-target
/etc/rtslib-fb-target: | pkg._
	sudo --preserve-env -- /usr/local/opt/iscsi/libexec/share.sh

clobber.iscsi:
	sudo --preserve-env -- /usr/local/opt/iscsi/libexec/unshare.sh
	sudo -- rm -v -fr -- /etc/rtslib-fb-target

clobber.samba:
	sudo rm -v -fr -- /var/lib/local/samba/usershares
