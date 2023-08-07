FROM ubuntu:latest

# hadolint ignore=DL3009
RUN apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends --yes -- \
  make \
  rsync \
  sudo \
  curl \
  jq \
  ca-certificates
