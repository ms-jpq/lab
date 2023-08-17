FROM ubuntu:latest

# hadolint ignore=DL3009
RUN apt-get update && \
  DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends --yes -- \
  ca-certificates \
  curl \
  git \
  jq \
  m4 \
  make \
  rsync \
  sudo

WORKDIR /srv
COPY . /srv
RUN gmake local
