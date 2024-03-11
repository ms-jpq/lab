.PHONY: gateway
all: gateway

gateway: /usr/local/opt/nginx/libexec/._htpasswd
/usr/local/opt/nginx/libexec/._htpasswd: $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/nginx/libexec/htpasswd.* /var/lib/local/htpasswd/*.txt)
	sudo -- /usr/local/libexec/try-reload.sh 0-htpasswd.service
	sudo -- touch -- '$@'

gateway: $(CACHE)/certbot/venv/bin/certbot
$(CACHE)/certbot/venv/bin/certbot:
	sudo -- /usr/local/opt/certbot/libexec/ensurepip.sh $(CACHE)/certbot
