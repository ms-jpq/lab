.PHONY: tofu tofu.bootstrap tofu.trunk

tofu: tf/bootstrap/.terraform
tf/bootstrap/.terraform:
	tofu -chdir='$(@D)' init

tofu.bootstrap: facts/.env tf/bootstrap/.terraform
	set -a
	source -- '$<'
	set +a
	tofu -chdir='tf/bootstrap' apply

tofu.trunk: tf/trunk/.terraform
tf/trunk/.terraform: | facts/.env
	set -a
	source -- '$|'
	set +a
	'$(@D)/init.sh'
