.PHONY: s3 push pull iam cost cpu

push pull s3: | $(VAR)/bin/s5cmd
	./libexec/s3.sh '$@'

iam cost cpu: | ./.venv/bin
	./libexec/aws.sh '$@'
