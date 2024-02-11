/usr/local/opt/btrfs/main.conf: $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/btrbk/conf.d/*)
	cat -- /dev/null $^ | sudo -- tee -- '$@'
