.PHONY: s3 push pull cost cpu

S5 := $(VAR)/bin/s5cmd

s3: | $(S5)
	./libexec/s3.sh

push pull: | $(S5)
	./libexec/s3.sh '$@'

cost cpu: | ./.venv/bin
	./libexec/aws.sh '$@'
