.PHONY: avahi
all: avahi

CLOBBER.FS += /etc/avahi/services/ssh.service

avahi: /etc/avahi/services/ssh.service

/usr/share/doc/avahi-daemon/examples/ssh.service: | pkg._

/etc/avahi/services/ssh.service: /usr/share/doc/avahi-daemon/examples/ssh.service
	sudo -- cp -v -- '$<' '$@'
