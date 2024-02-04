.PHONY: user samba iscsi clobber.samba clobber.iscsi

all: user samba iscsi

CLOBBER.FS += /etc/exports.d/* /etc/nfs.conf.d/* /etc/default/samba /var/lib/local/samba/usershares
CLOBBER.ISCSI := /etc/rtslib-fb-target /etc/iscsi/nodes /etc/iscsi/send_targets
CLOBBER.FS += $(CLOBBER.ISCSI)

pkg._: | /home/ubuntu
user: /home/ubuntu
/home/ubuntu:
	sudo -- useradd --user-group --create-home -- '$(@F)'

SMB_CONF := /usr/local/opt/samba/main/smb.conf
USER_SHARES := /var/lib/samba/usershares

samba: $(SMB_CONF)
/usr/local/opt/samba/smb.conf: /usr/local/opt/samba/main/smb.conf $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/samba/conf.d/*.conf)
	cat -- $^ '$@' | sudo tee -- '$@' >/dev/null

samba: $(USER_SHARES)
$(USER_SHARES): /usr/local/etc/default/shares.env $(SMB_CONF) /usr/local/opt/samba/libexec/share.sh | pkg._
	sudo -- mkdir -v -p -- '$@'
	sudo -- chgrp -- sambashare '$@'
	sudo -- chmod -- 1770 '$@'
	sudo -- /usr/local/opt/samba/libexec/share.sh '$(SMB_CONF)' '$<'

iscsi: /etc/rtslib-fb-target
/etc/rtslib-fb-target: | pkg._
	sudo --preserve-env -- /usr/local/opt/iscsi/libexec/share.sh

clobber.iscsi:
	sudo --preserve-env -- /usr/local/opt/iscsi/libexec/unshare.sh
	sudo -- rm -v -fr -- $(CLOBBER.ISCSI)

clobber.samba:
	sudo rm -v -fr -- '$(USER_SHARES)'
