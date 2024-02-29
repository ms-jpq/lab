all: /usr/local/lib/systemd/network/._touch

/usr/local/lib/systemd/network/._touch: $(shell shopt -u failglob && printf -- '%s ' /usr/local/lib/systemd/network/**/!(._touch))
	sudo -- chown -v -R -- systemd-network:systemd-network '$(@D)'
	sudo -- touch -- '$@'
