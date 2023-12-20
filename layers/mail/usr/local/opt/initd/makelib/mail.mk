.PHONY: mail
all: mail

mail: /var/lib/local/vmail

/var/lib/local/vmail:
	sudo -- mkdir --parents -- '$@'
	sudo -- chown -- '1000:1000' '$@'

mail: /usr/local/opt/apache2/apache2.conf

/etc/apache2/apache2.conf: | pkg._

/usr/local/opt/apache2/apache2.conf: /usr/local/opt/apache2/libexec/cfg.sed /etc/apache2/apache2.conf
	sudo -- /usr/local/libexec/sponge2.sh '$@' '$<' /etc/apache2/apache2.conf


define ZPUSH_TEMPLATE
/etc/z-push/$1.conf.php: | pkg._
mail: /usr/local/opt/z-push/$1.conf.php

/usr/local/opt/z-push/$1.conf.php: /usr/local/opt/z-push/libexec/$1.sed /etc/z-push/$1.conf.php
	sudo -- /usr/local/libexec/sponge2.sh '$$@' '$$<' /etc/z-push/$1.conf.php
endef

Z_PUSH_PHP := autodiscover imap z-push

$(foreach php,$(Z_PUSH_PHP),$(eval $(call ZPUSH_TEMPLATE,$(php))))
