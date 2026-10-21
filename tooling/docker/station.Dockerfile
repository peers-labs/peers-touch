# Station Dockerfile — multi-stage build
# Build: from project root, e.g. docker build -f tooling/docker/station.Dockerfile .

ARG BUILDER_IMAGE=golang:1.24.6@sha256:8d9e57c5a6f2bede16fe674c16149eee20db6907129e02c4ad91ce5a697a4012
ARG BASE_IMAGE=ubuntu:22.04@sha256:0a9887931b0e38af2e3487ed39e29436b0535c4f3f52e57745baaf79d1898956
ARG GO_VERSION=1.24.6

# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM ${BUILDER_IMAGE} AS builder

ARG GO_VERSION

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

ARG GOPROXY=https://goproxy.cn|https://mirrors.aliyun.com/goproxy/|direct
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
COPY tooling/plugins/build-lark-plugin.sh ./tooling/plugins/build-lark-plugin.sh

RUN /src/tooling/plugins/build-lark-plugin.sh \
    /out/plugins/lark \
    /src/station/app

# Build — ARGs declared here so changing commit/time only invalidates this layer,
# not the expensive apt-get / go-mod-download layers above.
WORKDIR /src/station/app
ARG BUILD_COMMIT=unknown
ARG BUILD_LABEL=dev
ARG BUILD_TIME=unknown
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildCommit=${BUILD_COMMIT} \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildLabel=${BUILD_LABEL} \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildTime=${BUILD_TIME}" \
    -o /out/peers-touch-station .
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildCommit=${BUILD_COMMIT} \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildLabel=secure-content-maintenance \
      -X github.com/peers-labs/peers-touch/station/app/subserver/app_meta.BuildTime=${BUILD_TIME}" \
    -o /out/secure-content-maintenance ./cmd/secure_content_maintenance

# ─── Stage 2: Runtime dependencies ─────────────────────────────────────────────
FROM ${BASE_IMAGE} AS runtime-base

ARG TARGETARCH
ARG LARK_CLI_VERSION=1.0.95

RUN sed -i \
      -e 's|http://archive.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
      -e 's|http://security.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
      -e 's|http://ports.ubuntu.com|http://mirrors.tuna.tsinghua.edu.cn|g' \
      /etc/apt/sources.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates tzdata wget gettext-base && \
    rm -rf /var/lib/apt/lists/*

RUN case "${TARGETARCH}" in \
      amd64) LARK_CLI_SHA256=7da92d426b7d000908c76a36b87a7d0357c270debf4c7149bbc6010b20d2541e ;; \
      arm64) LARK_CLI_SHA256=063012a63bb22479855e335d922cc588b883e00d115de51da76a8ffe22db987a ;; \
      riscv64) LARK_CLI_SHA256=88dacebc23f19a2749e64ee63049cd96e8e6b553c4225ed5d4cbf1e63e3053ff ;; \
      *) echo "unsupported lark-cli architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    LARK_CLI_ARCHIVE="lark-cli-${LARK_CLI_VERSION}-linux-${TARGETARCH}.tar.gz" && \
    wget -q "https://registry.npmmirror.com/-/binary/lark-cli/v${LARK_CLI_VERSION}/${LARK_CLI_ARCHIVE}" \
      -O "/tmp/${LARK_CLI_ARCHIVE}" && \
    echo "${LARK_CLI_SHA256}  /tmp/${LARK_CLI_ARCHIVE}" | sha256sum -c - && \
    mkdir -p /tmp/lark-cli-dist /usr/share/doc/lark-cli && \
    tar -xzf "/tmp/${LARK_CLI_ARCHIVE}" -C /tmp/lark-cli-dist && \
    install -m 0755 /tmp/lark-cli-dist/lark-cli /usr/local/bin/lark-cli && \
    install -m 0644 /tmp/lark-cli-dist/LICENSE /usr/share/doc/lark-cli/LICENSE && \
    test "$(lark-cli --version)" = "lark-cli version ${LARK_CLI_VERSION}" && \
    rm -rf "/tmp/${LARK_CLI_ARCHIVE}" /tmp/lark-cli-dist

# ─── Stage 3: Station runtime ──────────────────────────────────────────────────
FROM runtime-base AS runtime

WORKDIR /app

ENV PT_CHANNEL_LARK_CLI=/usr/local/bin/lark-cli \
    PT_CHANNEL_LARK_PLUGIN_PACKAGE=/app/plugins/lark \
    PT_CHANNEL_PLUGIN_ROOT=/app/data/channel/plugins

COPY --from=builder /out/peers-touch-station .
COPY --from=builder /out/secure-content-maintenance .
COPY --from=builder /out/plugins/ ./plugins/

COPY apps/station/app/conf/ ./conf/

RUN mkdir -p /app/data && \
    chmod 0700 /app/data /app/secure-content-maintenance

COPY tooling/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 18080 4001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["./peers-touch-station", "--config", "./conf/peers.yml"]

# Keep changing build metadata after all stable runtime layers.
ARG BUILD_COMMIT=unknown
ARG BUILD_LABEL=dev
ARG BUILD_TIME=unknown
LABEL org.opencontainers.image.revision="${BUILD_COMMIT}" \
      org.opencontainers.image.version="${BUILD_LABEL}" \
      org.opencontainers.image.created="${BUILD_TIME}"
