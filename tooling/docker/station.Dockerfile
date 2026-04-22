# Station Dockerfile — multi-stage build
# Build: from project root, e.g. docker build -f tooling/docker/station.Dockerfile .

FROM golang:1.24-alpine AS builder

RUN apk add --no-cache ca-certificates

# Go proxy — placed after apk add so changing it doesn't invalidate apk cache
ARG GOPROXY=https://goproxy.cn,https://goproxy.io,direct
ENV GOPROXY=${GOPROXY}

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

WORKDIR /src/station/app
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/peers-touch-station .

# ---

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /out/peers-touch-station .

# Default conf directory — baked in at build time
COPY apps/station/app/conf/ ./conf/

# Entrypoint script: generates store.docker.yml from PEERS_DB_DSN env var
COPY tooling/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 18080

ENTRYPOINT ["/entrypoint.sh"]
CMD ["./peers-touch-station", "--config", "./conf/peers.yml"]
