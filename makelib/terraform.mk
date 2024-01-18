.PHONY: tofu tofu.bootstrap

tofu: tf/bootstrap/.terraform
tf/bootstrap/.terraform:
	tofu -chdir='$(@D)' init

tofu.bootstrap: facts/.env tf/bootstrap/.terraform
	set -a
	source -- '$<'
	set +a
	tofu -chdir='tf/bootstrap' apply
