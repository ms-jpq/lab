.PHONY: mail
all: mail

mail: /var/lib/local/vmail

/var/lib/local/vmail: | pkg._
	sudo -- mkdir -v --parents -- '$@'
	sudo -- chown -v -- 'chasquid:chasquid' '$@'

mail: /usr/local/opt/apache2/apache2.conf

/etc/apache2/apache2.conf: | pkg._

/usr/local/opt/apache2/apache2.conf: /usr/local/opt/apache2/libexec/cfg.sed /etc/apache2/apache2.conf
	sudo -- /usr/local/libexec/sponge2.sh '$@' '$<' /etc/apache2/apache2.conf

CHASQUID_DOMAIN_DIR := /usr/local/opt/chasquid/domains/$(shell sed -E -e 's/^DOMAIN_NAME="([^"]+)"/\1/' -- /usr/local/etc/default/sieve.sh.cgi.env)

mail: $(CHASQUID_DOMAIN_DIR)

$(CHASQUID_DOMAIN_DIR):
	sudo -- mkdir -p -- '$@'
