.PHONY: local

e :=
s := ,
sp := $(e) $(e)


LSYNC := $(VAR)/sh/libexec/lsync.sh
$(LSYNC): $(VAR)/sh


define LOCAL_D_TEMPLATE
$(TMP)/$1/$2/: | $(TMP)/$1/$(dir $2)
	mkdir -v -p -- '$$@'
endef


define LOCAL_F_TEMPLATE
LOCALS.$1 += $(TMP)/$1/$(dir $2)$(patsubst !%,%,$(subst .m4.,.,$(notdir $2)))

$(TMP)/$1/$(dir $2)$(patsubst !%,%,$(subst .m4.,.,$(notdir $2))): $2 ./libexec/m4.sh $(TMP)/$1/facts.env | $(TMP)/$1/$(dir $2)
ifeq (!,$(findstring !,$2))
	cp -v -f -- '$$<' '$$@'
else
ifeq (.m4,$(suffix $(basename $2)))
	./libexec/m4.sh '$$<' '$$@' '$(TMP)/$1/facts.env'
else
	cp -v -P -f -- '$$<' '$$@'
endif
endif
endef


define LOCAL_L_TEMPLATE
LOCALS.$1 += $(TMP)/$1/layers/_/$3

$(VAR)/sh/$2: | $(VAR)/sh
$(TMP)/$1/layers/_/$3: $(VAR)/sh/$2
	mkdir -v -p -- '$$(@D)'
	cp -v -P -f -- '$$<' '$$@'
endef


define LOCAL_TEMPLATE
LOCALS.$1 :=

MACH.$1.LAYERS := layers/{$(subst $(sp),$(s),$(strip _ $(shell tr '\n' ' ' <'$1/layers.txt')))}
MACH.$1.DIRS := $$(shell find $$(MACH.$1.LAYERS) -type d)
MACH.$1.FILES := $$(shell find $$(MACH.$1.LAYERS) -type f,l)
MACH.$1.FACTS := $(FACTS) $(shell shopt -u failglob; printf -- '%s ' $1/facts/*.env)


$(TMP)/$1/./: | $(TMP)/$1
$(TMP)/$1: | $(TMP)
	mkdir -v -p -- '$$@'
$(TMP)/$1/layers/: | $(TMP)/$1
	mkdir -v -p -- '$$@'


$(TMP)/$1/facts.env: $$(MACH.$1.FACTS) $(TMP)/$1/mach.env | $(TMP)/$1
	printf -- '%s=%q\n' 'ENV_MACHINE' '$(notdir $1)' >'$$@'
	cat -- $$(MACH.$1.FACTS) '$(TMP)/$1/mach.env' >>'$$@'


$$(foreach layer,$$(MACH.$1.DIRS),$$(eval $$(call LOCAL_D_TEMPLATE,$1,$$(layer))))
$$(foreach layer,$$(MACH.$1.FILES),$$(eval $$(call LOCAL_F_TEMPLATE,$1,$$(layer))))
$$(foreach line,$(REF_LINKS),$$(eval $$(call LOCAL_L_TEMPLATE,$1,$$(firstword $$(subst !, ,$$(line))),$$(lastword $$(subst !, ,$$(line))))))


local: $(TMP)/$1/fs

$(TMP)/$1/fs: $(VAR)/sh/libexec/lsync.sh $$(LOCALS.$1) | $(VAR)/sh
	'$$<' '$$@' $(TMP)/$1/layers/*/
endef


define REF_LINKS

layers/posix/home/.local/opt/initd/libexec/curl-unpack.sh                                      usr/local/opt/initd/libexec/curl-unpack.sh
layers/posix/home/.local/opt/initd/libexec/pkg.sh                                              usr/local/opt/initd/libexec/pkg.sh
layers/ubuntu/home/.local/opt/initd/libexec/add-ppa.sh                                         usr/local/opt/initd/libexec/add-ppa.sh
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
