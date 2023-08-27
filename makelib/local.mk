.PHONY: local

e :=
s := ,
sp := $(e) $(e)

M4 := ./libexec/m4.sh $(shell printf -- '%s ' ./layers/_/usr/local/include/m4/*.m4)

LSYNC := $(VAR)/sh/libexec/lsync.sh
$(LSYNC): $(VAR)/sh

CGI := ./layers/_/usr/local/opt/cgi


define LOCAL_D_TEMPLATE
$(TMP)/$1/$2/: | $(TMP)/$1/$(dir $2)
	mkdir -v -p -- '$$@'
endef


define LOCAL_F_TEMPLATE
LOCALS.$1 += $(TMP)/$1/$(dir $2)$(patsubst !%,%,$(subst .m4.,.,$(notdir $2)))

ifeq (.m4,$(suffix $(basename $2)))
$(TMP)/$1/$(dir $2)$(patsubst !%,%,$(subst .m4.,.,$(notdir $2))): $2 $(M4) $(TMP)/$1/facts.env | $(TMP)/$1/$(dir $2)
	./libexec/m4.sh '$$<' '$$@' '$(TMP)/$1/facts.env'
else
$(TMP)/$1/$(dir $2)$(patsubst !%,%,$(subst .m4.,.,$(notdir $2))): $2 | $(TMP)/$1/$(dir $2)
ifeq (!,$(findstring !,$2))
	cp -v -f -- '$$<' '$$@'
else
	cp -v -P -f -- '$$<' '$$@'
endif
endif
endef


define LOCAL_L_TEMPLATE
LOCALS.$1 += $(TMP)/$1/links/$2

$(TMP)/$1/links/$2: | $(dir $(TMP)/$1/layers/_$2)
	ln -v -sf -- '$3' '$(TMP)/$1/layers/_$2'
	mkdir -v -p -- '$$(@D)'
	printf -- '%s' '$3' >'$$@'
endef


define LOCAL_RL_TEMPLATE
LOCALS.$1 += $(TMP)/$1/layers/_/$3

$(VAR)/sh/$2: | $(VAR)/sh
$(TMP)/$1/layers/_/$3: $(VAR)/sh/$2
	mkdir -v -p -- '$$(@D)'
	cp -v -P -f -- '$$<' '$$@'
endef


define LOCAL_C_TEMPLATE
LOCALS.$1.$2.LAYER := $(TMP)/$1/layers/$(firstword $(subst /,$(sp),$(patsubst layers/%,%,$2)))
LOCALS.$1.$2 := $(subst -,\x2d,$(subst .,\x2e,$(notdir $2)))

LOCALS.$1 += $$(LOCALS.$1.$2.LAYER)/usr/local/lib/systemd/system/6-cgi-$$(LOCALS.$1.$2).socket
$$(LOCALS.$1.$2.LAYER)/usr/local/lib/systemd/system/6-cgi-$$(LOCALS.$1.$2).socket: $(CGI)/6-cgi-.socket
	mkdir -v -p -- '$$(@D)'
	cp -v -f -- '$$<' '$$@'

LOCALS.$1 += $$(LOCALS.$1.$2.LAYER)/usr/local/lib/systemd/system/6-cgi-$$(LOCALS.$1.$2)@.service
$$(LOCALS.$1.$2.LAYER)/usr/local/lib/systemd/system/6-cgi-$$(LOCALS.$1.$2)@.service: $(CGI)/6-cgi-@.service
	mkdir -v -p -- '$$(@D)'
	cp -v -f -- '$$<' '$$@'

LOCALS.$1 += $$(LOCALS.$1.$2.LAYER)/usr/local/lib/systemd/system/sockets.target.wants/6-cgi-$$(LOCALS.$1.$2).socket
$$(LOCALS.$1.$2.LAYER)/usr/local/lib/systemd/system/sockets.target.wants/6-cgi-$$(LOCALS.$1.$2).socket: $$(LOCALS.$1.$2.LAYER)/usr/local/lib/systemd/system/6-cgi-$$(LOCALS.$1.$2).socket
	mkdir -v -p -- '$$(@D)'
	ln -v -sf -- '../6-cgi-$$(LOCALS.$1.$2).socket' '$$@'

LOCALS.$1 += $$(LOCALS.$1.$2.LAYER)/usr/local/opt/nginx/conf/server.d/$(notdir $2).cgi.nginx
$$(LOCALS.$1.$2.LAYER)/usr/local/opt/nginx/conf/server.d/$(notdir $2).cgi.nginx: $(CGI)/location.nginx ./libexec/m5.sh
	mkdir -v -p -- '$$(@D)'
	./libexec/m5.sh -D'ENV_PATH=$(notdir $2)' -D'ENV_SOCK=/run/local/cgi/$(notdir $2).sock' '$$<' >'$$@'
endef


define LOCAL_TEMPLATE
LOCALS.$1 :=

MACH.$1.LAYERS := layers/{$(subst $(sp),$(s),$(strip _ $(file <$1/usr/local/opt/initd/layers.txt)))}
MACH.$1.DIRS := $$(shell find $$(MACH.$1.LAYERS) -type d)
MACH.$1.FILES := $$(shell find $$(MACH.$1.LAYERS) -type f,l)
MACH.$1.CGI := $$(shell shopt -u failglob && printf -- '%s ' $$(MACH.$1.LAYERS)/usr/local/opt/cgi/bin/*)
MACH.$1.LINKS := $$(shell shopt -u failglob && grep -h -v -- '^#' $$(MACH.$1.LAYERS)/usr/local/opt/initd/links/*.txt $1/usr/local/opt/initd/links.txt | tr -s ' ' '!')

MACH.$1.FACTS := $(FACTS) $(shell shopt -u failglob && printf -- '%s ' $1/*.env)


$(TMP)/$1/./: | $(TMP)/$1
$(TMP)/$1: | $(TMP)
	mkdir -v -p -- '$$@'
$(TMP)/$1/layers/: | $(TMP)/$1
	mkdir -v -p -- '$$@'


$(TMP)/$1/facts.env: $$(MACH.$1.FACTS) $(TMP)/$1/mach.env | $(TMP)/$1
	printf -- '%s=%q\n' 'ENV_MACHINE' '$(notdir $1)' >'$$@'
	grep -h -v -- '^#' $$(MACH.$1.FACTS) '$(TMP)/$1/mach.env' >>'$$@'


$$(foreach layer,$$(MACH.$1.DIRS),$$(eval $$(call LOCAL_D_TEMPLATE,$1,$$(layer))))
$$(foreach layer,$$(MACH.$1.FILES),$$(eval $$(call LOCAL_F_TEMPLATE,$1,$$(layer))))
$$(foreach layer,$$(MACH.$1.CGI),$$(eval $$(call LOCAL_C_TEMPLATE,$1,$$(layer))))
$$(foreach layer,$$(MACH.$1.LINKS),$$(eval $$(call LOCAL_L_TEMPLATE,$1,$$(firstword $$(subst !, ,$$(layer))),$$(lastword $$(subst !, ,$$(layer))))))
$$(foreach line,$(REF_LINKS),$$(eval $$(call LOCAL_RL_TEMPLATE,$1,$$(firstword $$(subst !, ,$$(line))),$$(lastword $$(subst !, ,$$(line))))))


local: $(TMP)/$1/fs

$(TMP)/$1/fs: $(VAR)/sh/libexec/lsync.sh $$(LOCALS.$1) | $(VAR)/sh
	'$$<' '$$@' '$(TMP)/$1/layers'/*/
endef


define REF_LINKS

layers/posix/home/.local/opt/initd/libexec/curl-unpack.sh                                      usr/local/opt/initd/libexec/curl-unpack.sh
layers/posix/home/.local/opt/initd/libexec/pkg.sh                                              usr/local/opt/initd/libexec/pkg.sh
layers/ubuntu/home/.local/opt/initd/libexec/add-ppa.sh                                         usr/local/opt/initd/libexec/add-ppa.sh
layers/ubuntu/root/etc/apt/apt.conf.d/69dpkg-options                                           etc/apt/apt.conf.d/69dpkg-options
layers/ubuntu/root/etc/apt/apt.conf.d/69no-recommends                                          etc/apt/apt.conf.d/69no-recommends
layers/ubuntu/root/etc/apt/apt.conf.d/69unattended-upgrades                                    etc/apt/apt.conf.d/69unattended-upgrades
layers/ubuntu/root/etc/ssh/sshd_config.d/0-accept-env.conf                                     etc/ssh/sshd_config.d/0-accept-env.conf
layers/ubuntu/root/etc/ssh/sshd_config.d/0-security.conf                                       etc/ssh/sshd_config.d/0-security.conf
layers/ubuntu/root/usr/local/lib/sysctl.d/50-tcp-congestion.conf                               usr/local/lib/sysctl.d/50-tcp-congestion.conf
layers/ubuntu/root/usr/local/lib/systemd/resolved.conf.d/0-override.conf                       usr/local/lib/systemd/resolved.conf.d/0-override.conf
layers/ubuntu/root/usr/local/lib/systemd/system/systemd-tmpfiles-clean.timer.d/0-override.conf usr/local/lib/systemd/system/systemd-tmpfiles-clean.timer.d/0-override.conf
layers/ubuntu/root/usr/local/lib/systemd/timesyncd.conf.d/0-override.conf                      usr/local/lib/systemd/timesyncd.conf.d/0-override.conf
layers/ubuntu/root/usr/local/lib/systemd/user/systemd-tmpfiles-clean.timer.d/0-override.conf   usr/local/lib/systemd/user/systemd-tmpfiles-clean.timer.d/0-override.conf
zsh/iso/libexec/hr.sh                                                                          usr/local/libexec/hr.sh

endef

REF_LINKS := $(shell tr -s ' ' '!' <<<'$(REF_LINKS)')
$(foreach machine,$(MACHINES),$(eval $(call LOCAL_TEMPLATE,$(machine))))
