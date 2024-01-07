.PHONY: tofu tofu.bootstrap

facts tofu: facts/.env
facts/.env:
	touch -- '$@'

tofu: tf/bootstrap/.terraform
tf/bootstrap/.terraform:
	tofu -chdir='$(@D)' init

tofu.bootstrap: facts/.env tf/bootstrap/.terraform
	set -a
	source -- '$<'
	set +a
	tofu -chdir='tf/bootstrap' apply

tf/trunk/.terraform: | facts/.env
	set -a
	source -- '$<'
	set +a
	'$(@D)/init.sh'
