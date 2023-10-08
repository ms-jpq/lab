.PHONY: v2fly

v2fly: /usr/local/opt/v2fly/server.json
/usr/local/opt/v2fly/server.json: /usr/local/opt/v2fly/server.yml ./libexec/v2fly.py
	./libexec/v2fly.py <'$<' >'$@'
