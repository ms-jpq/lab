.PHONY: reload

reload: | all
	shopt -u failglob
	sudo -- systemctl daemon-reload --no-pager --show-transaction
	sudo -- systemctl --no-pager --show-transaction --failed --no-block -- restart '*'

reload-new: | reload
	find /run/systemd/generator/multi-user.target.wants -mindepth 1 -xtype f -printf '%f\0' | sudo -- xargs -0 --no-run-if-empty -- systemctl --no-pager --show-transaction --failed --no-block -- start
