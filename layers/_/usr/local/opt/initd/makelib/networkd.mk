all: $(CACHE)/initd/networkd

/usr/lib/systemd/network: pkg._

$(CACHE)/initd/networkd: /usr/local/lib/systemd/network/ $(shell shopt -u failglob && printf -- '%s ' /usr/local/lib/systemd/network/*) | /usr/lib/systemd/network
	sudo -- chown -v -R -- systemd-network:systemd-network '$<'
	sudo -- touch -- '$@'
