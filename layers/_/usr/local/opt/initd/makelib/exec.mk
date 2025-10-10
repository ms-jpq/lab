.PHONY: reload

reload: | all
	shopt -u failglob
	sudo -- systemctl daemon-reload --no-pager --show-transaction
	sudo -- systemctl --state masked --output json | jq --raw-output0 '.[].unit' | xargs --null --no-run-if-empty -- systemctl reset-failed --
	sudo -- systemctl --no-pager --show-transaction --failed --no-block -- restart '*'

reload-new: | reload
	shopt -u failglob
	DIRS=(/run/systemd/generator/*.target.wants /usr/local/lib/systemd/{system,user}/*.target.wants)
	find "$${DIRS[@]}" -mindepth 1 -xtype f -not -name '.gitignore' -printf '%f\0' | sudo -- xargs -0 --no-run-if-empty -- systemctl --no-pager --show-transaction --failed --no-block -- start
