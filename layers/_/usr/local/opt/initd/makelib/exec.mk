.PHONY: reload

reload: | pkg
	systemctl -- daemon-reload
	systemctl --failed
