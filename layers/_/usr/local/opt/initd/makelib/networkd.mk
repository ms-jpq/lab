
/usr/lib/systemd/network: pkg._

define SYSTEMD_CHOWN_TEMPLATE
all: $1/._touch
$1/._touch: $(shell shopt -u failglob && printf -- '%s ' $1/**/!(._touch)) | /usr/lib/systemd/network
	sudo -- chown -v -R -- $2:$2 '$$(@D)'
	sudo -- touch -- '$$@'
endef

$(eval $(call SYSTEMD_CHOWN_TEMPLATE,/usr/local/lib/systemd/network,systemd-network))
$(eval $(call SYSTEMD_CHOWN_TEMPLATE,/usr/local/lib/systemd/networkd.conf.d,systemd-network))
$(eval $(call SYSTEMD_CHOWN_TEMPLATE,/usr/local/lib/systemd/dnssd,systemd-resolve))
$(eval $(call SYSTEMD_CHOWN_TEMPLATE,/usr/local/lib/systemd/resolved.conf.d,systemd-resolve))
