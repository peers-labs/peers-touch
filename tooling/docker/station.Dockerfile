# Station Dockerfile — multi-stage build
# Build: from project root, e.g. docker build -f tooling/docker/station.Dockerfile .

ARG BUILDER_IMAGE=golang:1.24
ARG BASE_IMAGE=ubuntu:22.04

# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM ${BUILDER_IMAGE} AS builder

RUN if ! command -v go >/dev/null 2>&1; then \
      sed -i \
        -e 's|http://archive.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
        -e 's|http://security.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
        -e 's|http://ports.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
        /etc/apt/sources.list && \
      apt-get update && \
      apt-get install -y --no-install-recommends ca-certificates curl gcc && \
      rm -rf /var/lib/apt/lists/* && \
      ARCH=$(dpkg --print-architecture) && \
      curl -fsSL "https://mirrors.aliyun.com/golang/go${GO_VERSION}.linux-${ARCH}.tar.gz" \
        -o /tmp/go.tar.gz && \
      tar -C /usr/local -xzf /tmp/go.tar.gz && \
      rm /tmp/go.tar.gz; \
    fi

ENV PATH="/usr/local/go/bin:${PATH}"

ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=off
ENV GONOSUMCHECK=*
ENV GOTOOLCHAIN=local

WORKDIR /src

# Cache dependencies first.
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

# Build — ARGs declared here so changing commit/time only invalidates this layer,
# not the expensive apt-get / go-mod-download layers above.
WORKDIR /src/station/app
ARG BUILD_COMMIT=unknown
ARG BUILD_LABEL=dev
ARG BUILD_TIME=unknown
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildCommit=${BUILD_COMMIT} \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildLabel=${BUILD_LABEL} \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildTime=${BUILD_TIME}" \
    -o /out/peers-touch-station .

# ─── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM ${BASE_IMAGE}

RUN sed -i \
      -e 's|http://archive.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
      -e 's|http://security.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
      -e 's|http://ports.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
      /etc/apt/sources.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates tzdata wget gettext-base && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /out/peers-touch-station .

COPY apps/station/app/conf/ ./conf/

RUN mkdir -p /app/data && chmod 0700 /app/data

COPY tooling/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 18080 4001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["./peers-touch-station", "--config", "./conf/peers.yml"]
