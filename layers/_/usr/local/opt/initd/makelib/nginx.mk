.PHONY: nginx

nginx: $(CACHE)/venvs/nginx
	'$<'/bin/gixy -- /usr/local/opt/nginx/conf/main.nginx
