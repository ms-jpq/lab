CLOBBER.FS += /etc/jool/*
.PHONY: squid
all: squid

/etc/squid-deb-proxy/squid-deb-proxy.conf: pkg._

squid: /usr/local/opt/squid/etc/squid.conf
/usr/local/opt/squid/etc/squid.conf: /usr/local/opt/squid/squid.conf /etc/squid-deb-proxy/squid-deb-proxy.conf
	sudo -- cp -v -f -- '$<' '$@'
	grep -E -- '^refresh_pattern' '/etc/squid-deb-proxy/squid-deb-proxy.conf' | sudo -- tee --append -- '$@'
