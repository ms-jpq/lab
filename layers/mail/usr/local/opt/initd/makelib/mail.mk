.PHONY: mail
all: mail

mail: /var/lib/local/vmail

/var/lib/local/vmail:
	sudo -- mkdir -v --parents -- '$@'
	sudo -- chown -v -- 'chasquid:chasquid' '$@'

mail: /usr/local/opt/apache2/apache2.conf

/etc/apache2/apache2.conf: | pkg._

/usr/local/opt/apache2/apache2.conf: /usr/local/opt/apache2/libexec/cfg.sed /etc/apache2/apache2.conf
	sudo -- /usr/local/libexec/sponge2.sh '$@' '$<' /etc/apache2/apache2.conf
