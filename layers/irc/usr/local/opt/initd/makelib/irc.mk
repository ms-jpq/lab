.PHONY: irc

all: irc

irc: /etc/apt/trusted.gpg.d/weechat.gpg

/etc/apt/trusted.gpg.d/weechat.gpg:
	$(CURL) -- 'https://weechat.org/dev/info/debian_repository_signing_key' | sudo -- gpg --batch --dearmor --yes --output '$@'

