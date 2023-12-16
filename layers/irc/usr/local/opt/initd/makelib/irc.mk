.PHONY: irc

all: irc

irc: /etc/apt/trusted.gpg.d/weechat.gpg /usr/local/opt/weechat/scripts

/etc/apt/trusted.gpg.d/weechat.gpg:
	$(CURL) -- 'https://weechat.org/dev/info/debian_repository_signing_key' | sudo -- gpg --batch --dearmor --yes --output '$@'

/usr/local/opt/weechat/scripts:
	sudo -- git clone --depth=1 '--jobs=$(NPROC)' -- 'https://github.com/weechat/scripts.git' '$@'
