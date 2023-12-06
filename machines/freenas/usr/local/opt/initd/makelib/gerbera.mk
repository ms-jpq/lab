.PHONY: gerbera

gerbera: /usr/local/opt/gerbera/config.xml
all: gerbera

/etc/gerbera/config.xml: pkg._
/usr/local/opt/gerbera/config.xml: /usr/local/opt/gerbera/libexec/xml.sh /etc/gerbera/config.xml
	sudo -- /usr/local/libexec/sponge2.sh '$@' '$<' /etc/gerbera/config.xml
