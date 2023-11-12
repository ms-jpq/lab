.PHONY: mail
all: mail

mail: /var/lib/local/vmail
mail.clobber:
	sudo -- userdel --remove -- vmail

/home/vmail: | pkg._
	sudo -- useradd --create-home -- '$(@F)'

/var/lib/local/vmail: | /home/vmail
	sudo -- mkdir --parents -- '$@'
	sudo -- chown -- '$(@F):$(@F)' '$@'
