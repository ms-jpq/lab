.PHONY: local

e :=
s := ,
sp := $(e) $(e)

M4 := ./libexec/m4.sh $(shell printf -- '%s ' ./layers/_/usr/local/include/m4/*.m4)

define LOCAL_CLEAN_TEMPLATE
.PHONY: clean.$(notdir $1)
clean.$(notdir $1):
	rm -v -rf -- '$(TMP)/$1'
endef

$(foreach machine,$(ALL_MACHINES),$(eval $(call LOCAL_CLEAN_TEMPLATE,$(machine))))


define LOCAL_D_TEMPLATE
$(TMP)/$1/$(patsubst $1/%,layers/__/%,$2)/: | $(TMP)/$1/$(dir $(patsubst $1/%,layers/__/%,$2))
	mkdir -p -- '$$@'
endef


define LOCAL_F_TEMPLATE
LOCAL.$1.F := $(TMP)/$1/$(dir $(patsubst $1/%,layers/__/%,$2))$(patsubst !%,%,$(subst .m4.,.,$(notdir $2)))
LOCAL.$1.FF := $(TMP)/$1/$(dir $(patsubst $1/%,layers/__/%,$2))
LOCALS.$1 += $$(LOCAL.$1.F)

ifeq (.m4,$(suffix $(basename $2)))
$$(LOCAL.$1.F): $2 $(M4) $(TMP)/$1/facts.env | $$(LOCAL.$1.FF)
	./libexec/m4.sh '$$<' '$$@' '$(TMP)/$1/facts.env'
else
$$(LOCAL.$1.F): $2 | $$(LOCAL.$1.FF)
ifeq (!,$(findstring !,$2))
	cp -f -- '$$<' '$$@'
else
	cp -P -f -- '$$<' '$$@'
endif
endif
endef


define LOCAL_L_TEMPLATE
LOCAL.$1.L := $(TMP)/$1/links/$(patsubst $1/%,layers/__/%,$2)
LOCALS.$1 += $$(LOCAL.$1.L)

$$(LOCAL.$1.L): | $(dir $(TMP)/$1/layers/_$2)
	ln -sf -- '$3' '$(TMP)/$1/layers/_$(patsubst $1/%,layers/__/%,$2)'
	mkdir -p -- '$$(@D)'
	printf -- '%s' '$3' >'$$@'
endef


define LOCAL_RL_TEMPLATE
LOCALS.$1 += $(TMP)/$1/layers/_/$3

$(VAR)/sh/$2: | $(VAR)/sh
$(TMP)/$1/layers/_/$3: $(VAR)/sh/$2
	mkdir -p -- '$$(@D)'
	cp -r -P -f -- '$$<' '$$@'
endef


define LOCAL_TEMPLATE
LOCALS.$1 :=

MACH.$1.DIRS := $(shell find {$1,$2} -type d)
MACH.$1.FILES := $(shell find {$1,$2} -type f,l)
MACH.$1.LINKS := $(shell shopt -u failglob && sed -E -e '/^#/d' -- /dev/null {$1,$2}/usr/local/opt/initd/links/*.txt | tr -s -- ' ' '!')

MACH.$1.FACTS := $(FACTS) $(shell shopt -u failglob && printf -- '%s ' ./facts/$(notdir $1).*{env,json})


$(TMP)/$1/./: | $(TMP)/$1
$(TMP)/$1: | $(TMP)
	mkdir -p -- '$$@'
$(TMP)/$1/layers/: | $(TMP)/$1
	mkdir -p -- '$$@'
$(TMP)/$1/layers/__/: | $(TMP)/$1/layers/
	mkdir -p -- '$$@'


$(TMP)/$1/facts.env: ./libexec/facts.sh $$(MACH.$1.FACTS) $(TMP)/$1/mach.env | $(TMP)/$1
	'$$<' '$(notdir $1)' $$(MACH.$1.FACTS) '$(TMP)/$1/mach.env' >'$$@'


$$(foreach layer,$$(MACH.$1.DIRS),$$(eval $$(call LOCAL_D_TEMPLATE,$1,$$(layer))))
$$(foreach layer,$$(MACH.$1.FILES),$$(eval $$(call LOCAL_F_TEMPLATE,$1,$$(layer))))
$$(foreach layer,$$(MACH.$1.LINKS),$$(eval $$(call LOCAL_L_TEMPLATE,$1,$$(firstword $$(subst !, ,$$(layer))),$$(lastword $$(subst !, ,$$(layer))))))
$$(foreach line,$(REF_LINKS),$$(eval $$(call LOCAL_RL_TEMPLATE,$1,$$(firstword $$(subst !, ,$$(line))),$$(lastword $$(subst !, ,$$(line))))))


local: $(TMP)/$1/fs

$(TMP)/$1/fs: $(VAR)/sh/libexec/lsync.sh $$(LOCALS.$1) | $(VAR)/sh
	'$$<' '$$@' '$(TMP)/$1/layers'/*/
endef


define REF_LINKS

layers/posix/home/.local/opt/initd/libexec/curl-unpack.sh                                      usr/local/opt/initd/libexec/curl-unpack.sh
layers/posix/home/.local/opt/initd/libexec/pkg.sh                                              usr/local/opt/initd/libexec/pkg.sh
layers/posix/home/.local/opt/qemu/cloud-init                                                   usr/local/opt/qemu/cloud-init
layers/posix/home/.local/opt/qemu/libexec/cloud-init.sh                                        usr/local/opt/qemu/libexec/cloud-init.sh
layers/posix/home/.local/opt/qemu/libexec/ip64alloc.sh                                         usr/local/opt/network/libexec/ip64alloc.sh
layers/posix/home/.local/opt/qemu/libexec/ip64alloc.sh                                         usr/local/opt/qemu/libexec/ip64alloc.sh
layers/posix/home/.local/opt/qemu/libexec/pprint.sh                                            usr/local/opt/qemu/libexec/pprint.sh
layers/ubuntu/home/.local/opt/initd/libexec/add-ppa.sh                                         usr/local/opt/initd/libexec/add-ppa.sh
layers/ubuntu/home/.local/opt/initd/makelib/motd.ubuntu.mk                                     usr/local/opt/initd/makelib/motd.mk
layers/ubuntu/home/.local/opt/initd/packages/rmfr.txt                                          usr/local/opt/initd/packages/rmfr.txt
layers/ubuntu/root/etc/apt/apt.conf.d/69dpkg-options.conf                                      etc/apt/apt.conf.d/69dpkg-options.conf
layers/ubuntu/root/etc/apt/apt.conf.d/69no-recommends.conf                                     etc/apt/apt.conf.d/69no-recommends.conf
layers/ubuntu/root/etc/apt/apt.conf.d/69unattended-upgrades.conf                               etc/apt/apt.conf.d/69unattended-upgrades.conf
layers/ubuntu/root/etc/apt/preferences.d/0-nosnap.pref                                         etc/apt/preferences.d/0-nosnap.pref
layers/ubuntu/root/etc/avahi/avahi-daemon.conf                                                 usr/local/opt/avahi/avahi-daemon.conf
layers/ubuntu/root/etc/avahi/services/device-info.service.xml                                  etc/avahi/services/device-info.service
layers/ubuntu/root/etc/ssh/sshd_config.d/0-accept-env.conf                                     etc/ssh/sshd_config.d/0-accept-env.conf
layers/ubuntu/root/etc/ssh/sshd_config.d/0-security.conf                                       etc/ssh/sshd_config.d/0-security.conf
layers/ubuntu/root/usr/local/lib/sysctl.d/50-tcp-congestion.conf                               usr/local/lib/sysctl.d/50-tcp-congestion.conf
layers/ubuntu/root/usr/local/lib/systemd/resolved.conf.d/0-override.conf                       usr/local/lib/systemd/resolved.conf.d/0-override.conf
layers/ubuntu/root/usr/local/lib/systemd/system/systemd-tmpfiles-clean.timer.d/0-override.conf usr/local/lib/systemd/system/systemd-tmpfiles-clean.timer.d/0-override.conf
layers/ubuntu/root/usr/local/lib/systemd/timesyncd.conf.d/0-override.conf                      usr/local/lib/systemd/timesyncd.conf.d/0-override.conf
layers/ubuntu/root/usr/local/lib/systemd/user/systemd-tmpfiles-clean.timer.d/0-override.conf   usr/local/lib/systemd/user/systemd-tmpfiles-clean.timer.d/0-override.conf
zsh/iso/libexec/hr.sh                                                                          usr/local/libexec/hr.sh

endef

REF_LINKS := $(shell tr -s -- ' ' '!' <<<'$(REF_LINKS)')
$(foreach machine,$(MACHINES),$(eval $(call LOCAL_TEMPLATE,$(machine),layers/{$(subst $(sp),$(s),$(strip _ $(shell sed -E -e '/^#/d' -- /dev/null $(machine)/usr/local/opt/initd/layers.txt)))})))
