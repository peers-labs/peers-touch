# Go Builder Base — pre-built image with Go SDK + build essentials.
# Build once per architecture, then `station.Dockerfile` uses it as base.
#
#   docker build -f tooling/docker/builder-base.Dockerfile -t peers-station-builder:go1.24.6 .
#
# This image rarely changes (only on Go version bump or base OS update).

ARG BASE_IMAGE=ubuntu:22.04
ARG GO_VERSION=1.24.6

FROM ${BASE_IMAGE}

ARG GO_VERSION
ARG APT_MIRROR=
ARG GO_TARBALL_MIRROR=https://go.dev/dl
ARG GOPROXY=https://proxy.golang.org,direct
ARG GOSUMDB=sum.golang.org
ARG GONOSUMCHECK=

COPY tooling/docker/configure-apt-mirror.sh /tmp/configure-apt-mirror.sh
RUN sh /tmp/configure-apt-mirror.sh "${APT_MIRROR}"

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gcc && \
    rm -rf /var/lib/apt/lists/* && \
    ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "${GO_TARBALL_MIRROR%/}/go${GO_VERSION}.linux-${ARCH}.tar.gz" \
      -o /tmp/go.tar.gz && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz /tmp/configure-apt-mirror.sh

ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}
ENV GONOSUMCHECK=${GONOSUMCHECK}
ENV GOTOOLCHAIN=local
