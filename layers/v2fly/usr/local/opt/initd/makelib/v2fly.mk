.PHONY: v2fly
all: v2fly

define V2FLY_TEMPLATE
v2fly: /usr/local/opt/v2fly/$1.json 
/usr/local/opt/v2fly/$1.json: /usr/local/opt/v2fly/conf.yml ./libexec/v2fly.py
	./libexec/v2fly.py $1 <'$$<' >'$$@'
endef

$(foreach v2,server client,$(eval $(call V2FLY_TEMPLATE,$(v2))))
