.PHONY: gerbera

gerbera: /usr/local/opt/gerbera/config.xml
all: gerbera

/etc/gerbera/config.xml: pkg._
/usr/local/opt/gerbera/config.xml: /etc/gerbera/config.xml
	sudo -- xmllint --format --output '$@' '$<'
