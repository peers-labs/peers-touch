# Station Dockerfile — multi-stage build (offline-capable)
# Build: from project root, e.g. docker build -f tooling/docker/station.Dockerfile .
#
# Design: uses only locally-cached base images (ubuntu:22.04). Go SDK is
# downloaded from CN mirror (golang.google.cn) at build time — no Docker Hub
# dependency. After the first successful build, all layers are cached locally.

ARG BASE_IMAGE=ubuntu:22.04
ARG GO_VERSION=1.24.6

# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM ${BASE_IMAGE} AS builder

ARG GO_VERSION

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

# Cache dependencies first
# Directory layout mirrors local: /src/station/{app,frame} so replace directives
# (../../station/frame) resolve correctly from /src/station/app/
COPY apps/station/app/go.mod apps/station/app/go.sum ./station/app/
COPY apps/station/frame/go.mod apps/station/frame/go.sum ./station/frame/
COPY apps/station/frame/core/plugin/native/go.mod apps/station/frame/core/plugin/native/go.sum ./station/frame/core/plugin/native/
COPY apps/station/frame/core/plugin/store/rds/postgres/go.mod apps/station/frame/core/plugin/store/rds/postgres/go.sum ./station/frame/core/plugin/store/rds/postgres/
COPY apps/station/frame/core/plugin/store/rds/sqlite/go.mod apps/station/frame/core/plugin/store/rds/sqlite/go.sum ./station/frame/core/plugin/store/rds/sqlite/

WORKDIR /src/station/app
RUN go mod download

WORKDIR /src

# Copy full source
COPY apps/station/app/ ./station/app/
COPY apps/station/frame/ ./station/frame/

# Build — CGO_ENABLED=0 produces a static binary; GOARCH detected automatically.
WORKDIR /src/station/app
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/peers-touch-station .

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
