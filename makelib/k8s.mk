.PHONY: k8s helm

k8s: $(VAR)/bin/kompose $(VAR)/bin/kustomize
k8s: helm

helm: $(VAR)/helm/config/repositories.yaml
$(VAR)/helm/config/repositories.yaml: | $(VAR)/bin/helm
	./libexec/helm.sh repo add keel https://charts.keel.sh
	./libexec/helm.sh repo update