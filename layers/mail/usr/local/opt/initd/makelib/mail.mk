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


mail: /usr/local/opt/apache2/apache2.conf

/etc/apache2/apache2.conf: | pkg._

/usr/local/opt/apache2/apache2.conf: /usr/local/opt/apache2/libexec/cfg.sed /etc/apache2/apache2.conf
	sudo -- /usr/local/libexec/sponge2.sh '$@' '$<' /etc/apache2/apache2.conf
