.PHONY: printer
all: printer

printer: /usr/local/lib/cups/cupsd.conf

/etc/cups/cupsd.conf: | pkg._
/usr/local/lib/cups/cupsd.conf: /etc/cups/cupsd.conf | /usr/local/opt/cups/libexec/rewrite.sed
	/usr/local/opt/cups/libexec/rewrite.sed '$<' | sudo -- sponge -- '$@'
	sudo -- chgrp -- lpadmin '$@'
