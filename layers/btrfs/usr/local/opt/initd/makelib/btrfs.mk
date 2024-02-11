.PHONY: btrfs
all: btrfs

btrfs: /usr/local/opt/btrbk/main.conf
/usr/local/opt/btrbk/main.conf: $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/btrbk/conf.d/*.conf)
	cat -- /dev/null $^ | sudo -- tee -- '$@'
