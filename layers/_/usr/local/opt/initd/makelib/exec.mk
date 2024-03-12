.PHONY: reload

reload: | all
	sudo -- systemctl daemon-reload --no-pager --show-transaction
	sudo -- systemctl --no-pager --show-transaction --failed --no-block -- restart '*'
