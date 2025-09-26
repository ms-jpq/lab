.PHONY: nginx nginx.lint
all: nginx

pkg._: /etc/apt/trusted.gpg.d/nginx.gpg
/etc/apt/trusted.gpg.d/nginx.gpg:
	$(CURL) -- 'https://nginx.org/keys/nginx_signing.key' | sudo -- gpg --batch --dearmor --yes --output '$@'

nginx: /usr/local/opt/nginx/conf/._touch
/usr/local/opt/nginx/conf/._touch: $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/nginx/conf/**/*.nginx)
	sudo -- /usr/local/libexec/try-reload.sh nginx.service
	sudo -- touch -- '$@'


define NGINX_TEMPLATE
nginx: /var/lib/local/nginx/$2.htpasswd
/var/lib/local/nginx/$2.htpasswd: | pkg._
	tr --delete -- '\n' < '$1' | cut -d ' ' -f -2 | xargs --no-run-if-empty --max-args 2 -- sudo -- htpasswd -c -b -- '$$@'
endef

$(foreach realm,$(shell printf -- '%s ' /usr/local/opt/nginx/htpasswd/*.env),$(eval $(call NGINX_TEMPLATE,$(realm),$(subst .env,,$(notdir $(realm))))))

/opt/python3/gixy: | pkg._
nginx.lint: /opt/python3/gixy
	PYTHONPATH='$<' '$</bin/gixy' -- /usr/local/opt/nginx/conf/main.nginx
