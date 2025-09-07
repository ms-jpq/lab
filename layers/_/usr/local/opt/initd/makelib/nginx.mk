.PHONY: nginx nginx.lint
all: nginx

pkg._: /etc/apt/trusted.gpg.d/nginx.gpg
/etc/apt/trusted.gpg.d/nginx.gpg:
	$(CURL) -- 'https://nginx.org/keys/nginx_signing.key' | sudo -- gpg --batch --dearmor --yes --output '$@'

nginx: /usr/local/opt/nginx/conf/._touch
/usr/local/opt/nginx/conf/._touch: $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/nginx/conf/**/*.nginx)
	sudo -- /usr/local/libexec/try-reload.sh nginx.service
	sudo -- touch -- '$@'

nginx: /var/lib/local/nginx/8080.htpasswd
/var/lib/local/nginx/8080.htpasswd: | pkg._
	{
	  cat -- /usr/local/etc/default/nginx-8080.env | tr --delete -- '\n'
	  hostname
	} | b3sum | cut --delimiter ' ' --fields 1 | sudo -- htpasswd -c -b -i -- '$@' 8080

/opt/python3/gixy: | pkg._
nginx.lint: /opt/python3/gixy
	PYTHONPATH='$<' '$</bin/gixy' -- /usr/local/opt/nginx/conf/main.nginx
