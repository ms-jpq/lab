.PHONY: mail
all: mail

mail: /var/lib/local/vmail

/var/lib/local/vmail:
	sudo -- mkdir -v --parents -- '$@'
	sudo -- chown -v -- '1000:1000' '$@'


define ZPUSH_TEMPLATE
/opt/z-push/$1/config.php: | pkg._

mail: /usr/local/opt/z-push/$(patsubst .%,%,$2.conf.php)
/usr/local/opt/z-push/$(patsubst .%,%,$2.conf.php): /usr/local/opt/z-push/libexec/$2.sed /opt/z-push/$1/config.php
	sudo -- /usr/local/libexec/sponge2.sh '$$@' '$$<' /opt/z-push/$1/config.php
	! git diff --no-index --no-prefix --color-moved -- '/opt/z-push/$1/config.php' '$$@' | delta --side-by-side --light --width=120
endef

Z_PUSH_PHP := autodiscover backend/imap .

$(foreach php,$(Z_PUSH_PHP),$(eval $(call ZPUSH_TEMPLATE,$(php),$(subst .,,$(notdir $(php))))))
