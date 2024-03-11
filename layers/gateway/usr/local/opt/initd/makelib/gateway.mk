.PHONY: gateway
all: gateway

gateway: $(CACHE)/certbot/venv/bin/certbot
$(CACHE)/certbot/venv/bin/certbot:
	sudo -- /usr/local/opt/certbot/libexec/ensurepip.sh $(CACHE)/certbot
