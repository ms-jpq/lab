.PHONY: nginx nginx.lint
all: nginx

nginx: /usr/local/opt/nginx/conf/._touch
/usr/local/opt/nginx/conf/._touch: $(shell shopt -u failglob && printf -- '%s ' /usr/local/opt/nginx/conf/**/*.nginx)
	sudo -- /usr/local/libexec/try-reload.sh nginx.service
	sudo -- touch -- '$@'

nginx.lint:
	'$<'/bin/gixy -- /usr/local/opt/nginx/conf/main.nginx
