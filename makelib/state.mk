.PHONY: s3 push pull cost cpu

push pull s3: | $(VAR)/bin/s5cmd
	./libexec/s3.sh '$@'

cost cpu: | ./.venv/bin
	./libexec/aws.sh '$@'
