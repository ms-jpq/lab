.PHONY: swapon
all: swapon

swapon: /swapfile

/swapfile:
	sudo -- dd bs=1M count=1024 if=/dev/zero of='$@'
	sudo -- mkswap -- '$@'
