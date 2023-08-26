.PHONY: printer
all: printer

printer: /var/lib/local/cups/cupsd.conf
/var/lib/local/cups/cupsd.conf: /usr/local/opt/cups/libexec/rewrite.sed /etc/cups/cupsd.conf
	mkdir -v -p -- '$(@D)'
	'$<' '/etc/cups/cupsd.conf' >'$@'
