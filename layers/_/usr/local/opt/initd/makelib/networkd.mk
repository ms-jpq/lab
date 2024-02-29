all: /usr/local/lib/systemd/network/._touch

/usr/lib/systemd/network: pkg._

/usr/local/lib/systemd/network/._touch: $(shell shopt -u failglob && printf -- '%s ' /usr/local/lib/systemd/network/**/!(._touch)) | /usr/lib/systemd/network
	sudo -- chown -v -R -- systemd-network:systemd-network '$(@D)'
	sudo -- touch -- '$@'
