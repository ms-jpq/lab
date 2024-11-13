.PHONY: openvpn
all: openvpn

$(eval $(call SYSTEMD_CHOWN_TEMPLATE,/usr/local/opt/openvpn,systemd-network))

/usr/lib/systemd/system/openvpn@.service: | pkg._
openvpn: /usr/local/lib/systemd/system/1-ovpn-udp@.service /usr/local/lib/systemd/system/1-ovpn-tcp@.service
/usr/local/lib/systemd/system/1-ovpn-udp@.service /usr/local/lib/systemd/system/1-ovpn-tcp@.service: /usr/lib/systemd/system/openvpn@.service
	sudo -- cp -v -f -- '$<' '$@'
