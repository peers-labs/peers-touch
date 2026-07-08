# Station Dockerfile — multi-stage build (offline-capable)
# Build: from project root, e.g. docker build -f tooling/docker/station.Dockerfile .
#
# Design: uses only locally-cached base images (ubuntu:22.04). Go SDK is
# downloaded from CN mirror (golang.google.cn) at build time — no Docker Hub
# dependency. After the first successful build, all layers are cached locally.

ARG BASE_IMAGE=ubuntu:22.04
ARG GO_VERSION=1.24.6
ARG BUILD_COMMIT=unknown
ARG BUILD_LABEL=dev
ARG BUILD_TIME=unknown

# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM ${BASE_IMAGE} AS builder

ARG GO_VERSION
ARG BUILD_COMMIT
ARG BUILD_LABEL
ARG BUILD_TIME

# Switch to TUNA mirror for apt (CN network)
RUN sed -i 's|http://ports.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list

# Install build essentials + download Go from Aliyun mirror (CN accessible)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl gcc && \
    rm -rf /var/lib/apt/lists/* && \
    ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://mirrors.aliyun.com/golang/go${GO_VERSION}.linux-${ARCH}.tar.gz" \
      -o /tmp/go.tar.gz && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz

ENV PATH="/usr/local/go/bin:${PATH}"

# Go proxy — goproxy.cn for CN network; direct as fallback.
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}

# Disable GOSUMDB to avoid unreachable sum.golang.org — go.sum is committed.
# GOTOOLCHAIN=local prevents auto-downloading newer Go toolchains.
# GONOSUMCHECK=* skips checksum verification for any module.
ENV GOSUMDB=off
ENV GONOSUMCHECK=*
ENV GOTOOLCHAIN=local

WORKDIR /src

# Cache dependencies first.
# Directory layout mirrors local replace targets from /src/station/app:
# - ../../station/frame -> /src/station/frame
# - ../../applets/<id>/service -> /src/applets/<id>/service
COPY apps/station/app/go.mod apps/station/app/go.sum ./station/app/
COPY apps/station/frame/go.mod apps/station/frame/go.sum ./station/frame/
COPY apps/station/frame/core/plugin/native/go.mod apps/station/frame/core/plugin/native/go.sum ./station/frame/core/plugin/native/
COPY apps/station/frame/core/plugin/store/rds/postgres/go.mod apps/station/frame/core/plugin/store/rds/postgres/go.sum ./station/frame/core/plugin/store/rds/postgres/
COPY apps/station/frame/core/plugin/store/rds/sqlite/go.mod apps/station/frame/core/plugin/store/rds/sqlite/go.sum ./station/frame/core/plugin/store/rds/sqlite/
COPY apps/applets/ ./applets/

WORKDIR /src/station/app
RUN go mod download

WORKDIR /src

# Copy full source
COPY apps/station/app/ ./station/app/
COPY apps/station/frame/ ./station/frame/
COPY apps/applets/ ./applets/

# Build — CGO_ENABLED=0 produces a static binary; GOARCH detected automatically.
WORKDIR /src/station/app
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildCommit=${BUILD_COMMIT} \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildLabel=${BUILD_LABEL} \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildTime=${BUILD_TIME}" \
    -o /out/peers-touch-station .

# ─── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM ${BASE_IMAGE}

RUN sed -i 's|http://ports.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates tzdata wget gettext-base && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /out/peers-touch-station .

# Default conf directory — baked in at build time
COPY apps/station/app/conf/ ./conf/

# Persistent state lives under /app/data so a single Docker named volume
# (`peers_data`) covers both libp2p identity keys (transport's
# libp2pIdentity.key and bootstrap subserver's bootstrap.key). The
# entrypoint emits paths.docker.yml to redirect the configured paths here.
RUN mkdir -p /app/data && chmod 0700 /app/data

# Entrypoint script: emits hierarchy-merge overlays (store/paths/bootstrap).
COPY tooling/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 18080 4001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["./peers-touch-station", "--config", "./conf/peers.yml"]
