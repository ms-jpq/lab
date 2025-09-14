pkg._: /etc/apt/trusted.gpg.d/grafana.gpg
/etc/apt/trusted.gpg.d/grafana.gpg:
	$(CURL) -- 'https://apt.grafana.com/gpg.key' | sudo -- gpg --batch --dearmor --yes --output '$@'
