.PHONY: build

ifeq (x86_64-nt, $(HOSTTYPE)-$(OS))
build: ./docker/nt.Dockerfile
	docker build --tag 'lab' --file '$<' -- .
else
build: ./docker/ubuntu.Dockerfile
	docker buildx build --progress plain --tag 'lab' --file '$<' -- .
endif
