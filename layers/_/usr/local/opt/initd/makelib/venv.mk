.PHONY: venv

define PYNV_TEMPLATES

venv: /usr/local/venv/$1
/usr/local/venv/$1: | /usr/share/doc/python3-venv
	sudo -- python3 -m venv -- '$$@'
	sudo -- '$$@'/bin/pip install --upgrade --requirement './venvs/$1.txt'

endef

$(foreach venv,$(shell shopt -u failglob && printf -- '%s ' ./venvs/*.txt),$(eval $(call PYNV_TEMPLATES,$(patsubst ./venvs/%,%,$(basename $(venv))))))
