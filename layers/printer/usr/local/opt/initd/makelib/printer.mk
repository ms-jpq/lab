.PHONY: printer
all: printer

/etc/cups/cupsd.conf: | pkg._

printer: /home/cups
printer.clobber:
	sudo -- userdel --remove -- cups

/home/cups: | /etc/cups/cupsd.conf
	PASSWORD="$$(openssl passwd -1 -- '$(@F)')"
	sudo -- useradd --create-home --gid lpadmin --password "$$PASSWORD" -- '$(@F)'
