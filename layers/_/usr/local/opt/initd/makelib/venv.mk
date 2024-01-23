.PHONY: venv clobber.venv

clobber.venv:
	sudo -- rm -v -fr -- '$(CACHE)/venvs'

define PYNV_TEMPLATES

venv: $(CACHE)/venvs/$1
$(CACHE)/venvs/$1: | /usr/share/doc/python3-venv
	sudo -- rm -v -fr -- '$$@'
	sudo -- python3 -m venv -- '$$@'
	sudo -- '$$@'/bin/pip install --upgrade --requirement './venvs/$1.txt'

endef

$(foreach venv,$(shell shopt -u failglob && printf -- '%s ' ./venvs/*.txt),$(eval $(call PYNV_TEMPLATES,$(patsubst ./venvs/%,%,$(basename $(venv))))))
