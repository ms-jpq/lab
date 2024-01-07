.PHONY: tofu tofu.bootstrap

facts tofu: facts/.env
facts/.env:
	touch -- '$@'

tofu: tf/bootstrap/.terraform tf/trunk/.terraform
tf/bootstrap/.terraform tf/trunk/.terraform:
	tofu -chdir='$(@D)' init

tofu.bootstrap: facts/.env tf/bootstrap/.terraform
	set -a
	source -- '$<'
	set +a
	tofu -chdir='tf/bootstrap' apply
