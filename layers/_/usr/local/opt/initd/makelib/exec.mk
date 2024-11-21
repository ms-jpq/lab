.PHONY: reload

reload: | all
	shopt -u failglob
	sudo -- systemctl daemon-reload --no-pager --show-transaction
	sudo -- systemctl --no-pager --show-transaction --failed --no-block -- restart '*'
	sudo -- systemctl --no-pager --show-transaction --failed --no-block -- start /run/systemd/generator/multi-user.target.wants/*
