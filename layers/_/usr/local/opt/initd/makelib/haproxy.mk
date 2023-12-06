.PHONY: haproxy

haproxy: /usr/local/opt/haproxy/haproxy.cfg /usr/local/opt/haproxy/gen.cfg
all: haproxy

/etc/haproxy/haproxy.cfg: | pkg._

/usr/local/opt/haproxy/haproxy.cfg: /usr/local/opt/haproxy/libexec/cfg.sed /etc/haproxy/haproxy.cfg
	sudo -- /usr/local/libexec/sponge2.sh '$@' '$<' /etc/haproxy/haproxy.cfg

/usr/local/opt/haproxy/gen.cfg: $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/haproxy/conf.d/*.cfg) | /etc/haproxy/haproxy.cfg
	sudo -- /usr/local/libexec/sponge2.sh '$@' cat -- /dev/null '$^'
