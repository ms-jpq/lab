.PHONY: reload

reload: | all
	./libexec/systemd-reload.sh
