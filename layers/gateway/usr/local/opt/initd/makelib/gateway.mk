.PHONY: gateway

gateway: $(CACHE)/certbot/venv/bin/certbot
all: gateway

$(CACHE)/certbot/venv/bin/certbot:
	sudo -- /usr/local/opt/certbot/libexec/ensurepip.sh $(CACHE)/certbot
