.PHONY: reload

reload: | all
	systemctl daemon-reload --no-pager --show-transaction
	/usr/local/libexec/systemd-reload.sh
