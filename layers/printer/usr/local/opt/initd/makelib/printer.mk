.PHONY: printer
all: printer

printer: /usr/local/lib/cups/cupsd.conf
printer.clobber:
	sudo -- userdel --remove -- cups

/home/cups:
	PASSWORD="$$(openssl passwd -1 -- '$(@F)')"
	sudo -- useradd --create-home --gid lpadmin --password "$$PASSWORD" -- '$(@F)'

/etc/cups/cupsd.conf: | pkg._
/usr/local/lib/cups/cupsd.conf: /etc/cups/cupsd.conf | /usr/local/opt/cups/libexec/rewrite.sed /home/cups
	sudo -- cp -- '$<' '$@'
	sudo -- chown -- lp:lp /usr/local/lib/cups/**/*
