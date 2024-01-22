.PHONY: nginx

nginx: /usr/local/venvs/nginx
	'$<'/bin/gixy -- /usr/local/opt/nginx/conf/main.nginx
