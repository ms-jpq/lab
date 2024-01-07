.PHONY: tofu

facts tofu: facts/.env
facts/.env:
	touch -- '$@'

tofu: tf/bootstrap/.terraform tf/trunk/.terraform
tf/bootstrap/.terraform tf/trunk/.terraform:
	tofu -chdir='$(@D)' init
