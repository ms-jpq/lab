.PHONY: reload

reload: | all
	systemctl daemon-reload --no-pager --show-transaction
	./libexec/systemd-reload.sh
