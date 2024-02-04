.PHONY: user samba iscsi elasticsearch clobber.samba clobber.iscsi clobber.elasticsearch

all: user samba iscsi elasticsearch

CLOBBER.FS += /etc/exports.d/* /etc/nfs.conf.d/* /etc/default/samba /var/lib/local/samba/usershares
CLOBBER.ISCSI := /etc/rtslib-fb-target /etc/iscsi/nodes /etc/iscsi/send_targets
CLOBBER.FS += $(CLOBBER.ISCSI)

SMB_CONF := /usr/local/opt/samba/main/smb.conf
USER_SHARES := /var/lib/samba/usershares

samba: /usr/local/opt/samba/smb.conf
/usr/local/opt/samba/smb.conf: /usr/local/opt/samba/libexec/conf.sh $(SMB_CONF) $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/samba/conf.d/*.conf) | /usr/bin/envsubst
	sudo -- '$<' '$@' $^
	sudo -- /usr/local/bin/smbctl.sh smbd reload-config

/etc/samba/smb.conf: | pkg._
samba: $(USER_SHARES)
$(USER_SHARES): /usr/local/opt/samba/libexec/share.sh $(SMB_CONF) /usr/local/etc/default/shares.env | /etc/samba/smb.conf
	sudo -- mkdir -v -p -- '$@'
	sudo -- chgrp -- sambashare '$@'
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

pkg._: /etc/apt/trusted.gpg.d/elastic-search.gpg
/etc/apt/trusted.gpg.d/elastic-search.gpg:
	$(CURL) -- 'https://artifacts.elastic.co/GPG-KEY-elasticsearch' | sudo -- gpg --batch --dearmor --yes --output '$@'

/etc/elasticsearch/jvm.options: | pkg._
elasticsearch: /usr/local/opt/elasticsearch/jvm.options
/usr/local/opt/elasticsearch/jvm.options: /etc/elasticsearch/jvm.options
	sudo -- sed -E -e 's#/var/log/#/var/tmp/#' -- '$<' | sudo -- tee -- '$@' >/dev/null
