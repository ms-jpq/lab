define MACH_DETECT
case "$$MACHTYPE" in
aarch64*)
	printf -- '%s' aarch64
	;;
x86_64*)
	printf -- '%s' x86_64
	;;
*)
	exit 1
	;;
esac
endef

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

MACHTYPE := $(shell $(MACH_DETECT))
OS := $(shell $(OS_DETECT))

ifeq ($(MACHTYPE), aarch64)
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

NPROC := $(shell ./libexec/nproc.sh)
