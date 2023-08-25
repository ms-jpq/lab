define OS_DETECT
case "$$OSTYPE" in
darwin*)
	printf -- '%s' darwin
	;;
linux*)
	printf -- '%s' linux
	;;
msys)
	printf -- '%s' nt
	;;
*)
	exit 1
	;;
esac
endef

HOSTTYPE := $(shell printf -- '%s' "$$HOSTTYPE")
OS := $(shell $(OS_DETECT))


ifeq ($(HOSTTYPE), aarch64)
BREW_PREFIX := /opt/homebrew
GOARCH := arm64
else
BREW_PREFIX := /usr/local
GOARCH := amd64
endif


ifeq ($(OS),nt)
define NT_2_UNIX
$(subst :,\:,$(subst \,/,$1))
endef
define UNIX_2_NT
$(subst /,\,$(subst \:,:,$1))
endef
else
define NT_2_UNIX
$1
endef
define UNIX_2_NT
$1
endef
endif


ifeq (nt, $(OS))
PY_BIN := Scripts
else
PY_BIN := bin
endif


ifeq (nt, $(OS))
MSYS_PREFIX := /$(subst :,,$(SYSTEMDRIVE))/msys64/
else
MSYS_PREFIX :=
endif


ifeq (darwin, $(OS))
NPROC := $(shell sysctl -n hw.physicalcpu)
else
NPROC := $(shell nproc)
endif


ifeq (linux, $(OS))
VERSION_ID := $(shell perl -CASD -wne '/^VERSION_ID="(.+)"$$/ && print $$1' </etc/os-release)
VERSION_CODENAME := $(shell perl -CASD -wne '/^VERSION_CODENAME=(.+)$$/ && print $$1' </etc/os-release)
else
ifeq (darwin, $(OS))
VERSION_ID := $(shell sw_vers -productVersion)
VERSION_CODENAME := $(VERSION_ID)
else
VERSION_ID := $(shell wmic os get Version | tr -d '\r')
VERSION_CODENAME := $(VERSION_ID)
endif
endif
