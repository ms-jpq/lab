.PHONY: nginx nginx.lint
all: nginx

pkg._: /etc/apt/trusted.gpg.d/nginx.gpg
/etc/apt/trusted.gpg.d/nginx.gpg:
	$(CURL) -- 'https://nginx.org/keys/nginx_signing.key' | sudo -- gpg --batch --dearmor --yes --output '$@'

nginx: /usr/local/opt/nginx/conf/._touch
/usr/local/opt/nginx/conf/._touch: $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/nginx/conf/**/*.nginx)
	sudo -- /usr/local/libexec/try-reload.sh nginx.service
	sudo -- touch -- '$@'

/opt/python3/gixy: | pkg._
nginx.lint: /opt/python3/gixy
	PYTHONPATH='$<' '$</bin/gixy' -- /usr/local/opt/nginx/conf/main.nginx
