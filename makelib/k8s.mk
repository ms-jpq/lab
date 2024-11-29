.PHONY: k8s helm

k8s: $(VAR)/sh
k8s: $(VAR)/bin/kompose $(VAR)/bin/kustomize
k8s: helm

helm: $(VAR)/helm/config/repositories.yaml
$(VAR)/helm/config/repositories.yaml: | $(VAR)/bin/helm
	./libexec/helm.sh '' repo add keel     'https://charts.keel.sh'
	./libexec/helm.sh '' repo add nvdp     'https://nvidia.github.io/k8s-device-plugin'
	./libexec/helm.sh '' repo add nvidia   'https://helm.ngc.nvidia.com/nvidia'
	./libexec/helm.sh '' repo add stakater 'https://stakater.github.io/stakater-charts'
	./libexec/helm.sh '' repo update
