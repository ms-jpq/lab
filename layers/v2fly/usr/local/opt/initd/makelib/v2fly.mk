.PHONY: v2fly
all: v2fly

/usr/share/doc/python3-yaml: | pkg._

define V2FLY_TEMPLATE
v2fly: /usr/local/opt/v2fly/$1.json
/usr/local/opt/v2fly/$1.json: /usr/local/opt/v2fly/conf.yml ./libexec/v2fly.py | /usr/share/doc/python3-yaml
	./libexec/v2fly.py $1 <'$$<' | sudo -- sponge -- '$$@'
endef

$(foreach v2,server client,$(eval $(call V2FLY_TEMPLATE,$(v2))))

V2FLY := https://github.com/v2fly/v2ray-core/releases/latest/download/v2ray-linux-64.zip

$(TMP)/v2fly.zip: | /usr/bin/curl
	sudo -- $(CURL) --output '$@.tmp' -- '$(V2FLY)'
	sudo -- mv -v -f -- '$@.tmp' '$@'

v2fly: /usr/local/libexec/v2ray
/usr/local/libexec/v2ray: $(TMP)/v2fly.zip | /usr/bin/unzip
	sudo -- unzip -o -d '$(TMP)' -- '$<'
	sudo -- mv -v -- '$(TMP)'/geo{ip,site}.dat /var/lib/local/v2fly/
	sudo -- install -b -- '$(TMP)/v2ray' '$@'
