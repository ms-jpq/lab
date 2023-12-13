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

ENV LOCAL=1
RUN touch -- /.dockerenv /usr/share/doc/avahi-daemon/examples/ssh.service && gmake example && gmake
RUN ./main.sh --machine all
