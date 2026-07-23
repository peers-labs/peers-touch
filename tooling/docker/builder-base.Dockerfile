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

RUN sed -i \
      -e 's|http://archive.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
      -e 's|http://security.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
      -e 's|http://ports.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
      /etc/apt/sources.list

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gcc && \
    rm -rf /var/lib/apt/lists/* && \
    ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://mirrors.aliyun.com/golang/go${GO_VERSION}.linux-${ARCH}.tar.gz" \
      -o /tmp/go.tar.gz && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz

ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOSUMDB=off
ENV GONOSUMCHECK=*
ENV GOTOOLCHAIN=local
