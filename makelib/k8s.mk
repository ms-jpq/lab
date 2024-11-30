.PHONY: k8s helm

k8s: $(VAR)/sh
k8s: $(VAR)/bin/kompose $(VAR)/bin/kustomize $(VAR)/bin/helm
