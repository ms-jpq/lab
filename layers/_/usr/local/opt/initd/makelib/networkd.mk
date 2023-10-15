all: $(CACHE)/initd/networkd

$(CACHE)/initd/networkd: /usr/local/lib/systemd/network/ $(shell shopt -u failglob && printf -- '%s ' /usr/local/lib/systemd/network/*)
	[[ -v CI ]] || sudo -- chown -R -- systemd-network:systemd-network '$<'
	sudo -- touch -- '$@'
