.PHONY: reload

reload: | pkg
	./libexec/systemd-reload.sh
