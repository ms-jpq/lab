/usr/local/opt/haproxy/haproxy.cfg: $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/haproxy/conf.d/*.cfg)
	cat -- /dev/null '$^' >'$@'
