.PHONY: zfs samba iscsi

samba: /var/lib/local/samba/usershares

/var/lib/local/samba/usershares: | pkg._
	mkdir -v -p -- '$@'
	chown -- root:sambashare '$@'
	chmod -- 1770 '$@'

iscsi: /etc/rtslib-fb-target
/etc/rtslib-fb-target: | pkg._
