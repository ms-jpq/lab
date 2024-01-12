.PHONY: spotifyd

all: spotifyd

spotifyd: $(CACHE)/spotifyd/spotifyd

$(CACHE)/spotifyd/spotifyd:
	sudo -- /usr/local/opt/spotifyd/libexec/ensure.sh '$(@D)'
