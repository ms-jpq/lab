.PHONY: mail
all: mail

mail: /var/lib/local/vmail
mail.clobber:
	sudo -- userdel --remove -- vmail

/home/vmail: | pkg._
	sudo -- useradd --create-home -- '$(@F)'

/var/lib/local/vmail: | /home/vmail
	sudo -- mkdir --parents -- '$@'
	sudo -- chown -- '$(@F):$(@F)' '$@'


mail: /usr/local/opt/lighttpd/lighttpd.conf

/etc/lighttpd/lighttpd.conf: | pkg._

/usr/local/opt/lighttpd/lighttpd.conf: /usr/local/opt/lighttpd/libexec/cfg.sed /etc/lighttpd/lighttpd.conf
	sudo -- /usr/local/libexec/sponge2.sh '$@' '$<' /etc/lighttpd/lighttpd.conf
