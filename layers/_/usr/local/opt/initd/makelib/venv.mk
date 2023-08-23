.PHONY: venv

define PYNV_TEMPLATES

venv: $(patsubst ./venvs%,%,$1)
$(patsubst ./venvs%,%,$1): | /usr/share/doc/python3-venv
	python3 -m venv -- '$$@'
	'$$@'/bin/pip install --upgrade --requirement '$1'

endef

$(foreach venv,$(shell find ./venvs -type f -not -name '.gitignore'),$(info $(call PYNV_TEMPLATES,$(venv))))
