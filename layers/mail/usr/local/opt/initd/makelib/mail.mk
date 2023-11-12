.PHONY: mail
all: mail

mail: /var/lib/local/vmail
mail.clobber:
	sudo -- userdel --remove -- vmail

/var/lib/local/vmail: | pkg._
	sudo -- useradd --create-home --home-dir '$@' -- '$(@F)'
