.PHONY: xray
all: xray

/usr/share/doc/python3-yaml: | pkg._

define XRAY_TEMPLATE
xray: /usr/local/opt/xray/$1.json
/usr/local/opt/xray/$1.json: /usr/local/opt/xray/conf.yml ./libexec/xray.py | /usr/share/doc/python3-yaml
	./libexec/xray.py $1 < '$$<' | sudo -- sponge -- '$$@'
endef

$(foreach name,server client,$(eval $(call XRAY_TEMPLATE,$(name))))
