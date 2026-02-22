.PHONY: nfs samba iscsi clobber.samba clobber.iscsi

all: nfs samba iscsi

CLOBBER.FS += /etc/exports.d/* /etc/nfs.conf.d/* /etc/default/samba /var/lib/local/samba/usershares
CLOBBER.ISCSI := /etc/rtslib-fb-target /etc/iscsi/nodes /etc/iscsi/send_targets
CLOBBER.FS += $(CLOBBER.ISCSI)

SMB_CONF := /usr/local/opt/samba/main/smb.conf
USER_SHARES := /var/lib/samba/usershares

/usr/bin/resolvectl: pkg._
nfs: /etc/exports.d/._touch
/etc/exports.d/._touch: /usr/local/opt/nfs/libexec/dnssd.sh $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/nfs/services/* /etc/exports.d/*.exports) | /usr/bin/resolvectl
	sudo -- '$<' /etc/exports.d/*.exports
	sudo -- touch -- '$@'

# pkg._: /etc/apt/sources.list.d/ppa_linux-schools_samba-latest.list
# /etc/apt/sources.list.d/ppa_linux-schools_samba-latest.list:
# 	sudo -- ./libexec/add-ppa.sh linux-schools/samba-latest

samba: /usr/local/opt/samba/._touch
/usr/local/opt/samba/smb.conf: /usr/local/opt/samba/libexec/conf.sh $(SMB_CONF) $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/samba/conf.d/*.conf) | /usr/bin/envsubst
	sudo -- '$<' '$@' $^

/usr/local/opt/samba/._touch: /usr/local/opt/samba/smb.conf
	sudo -- /usr/local/bin/smbctl.sh smbd reload-config
	sudo -- touch -- '$@'

/etc/samba/smb.conf: | pkg._
samba: $(USER_SHARES)
$(USER_SHARES): /usr/local/opt/samba/libexec/share.sh $(SMB_CONF) /usr/local/etc/default/shares.env | /etc/samba/smb.conf
	sudo -- mkdir -v -p -- '$@'
	sudo -- chgrp -- 1000 '$@'
	sudo -- chmod -- 1770 '$@'
	sudo -- '$<' '$(SMB_CONF)' /usr/local/etc/default/shares.env

iscsi: /etc/rtslib-fb-target
/etc/rtslib-fb-target: | pkg._
	sudo --preserve-env -- /usr/local/opt/iscsi/libexec/share.sh

clobber.iscsi:
	sudo --preserve-env -- /usr/local/opt/iscsi/libexec/unshare.sh
	sudo -- rm -v -fr -- $(CLOBBER.ISCSI)

clobber.samba:
	sudo rm -v -fr -- '$(USER_SHARES)'
