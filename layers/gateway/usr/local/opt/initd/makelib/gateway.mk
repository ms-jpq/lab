.PHONY: gateway

gateway: $(CACHE)/certbot/venv/bin/certbot
all: gateway

$(CACHE)/certbot/venv/bin/certbot:
	systemctl start --show-transaction -- 0-certbot-update.service
