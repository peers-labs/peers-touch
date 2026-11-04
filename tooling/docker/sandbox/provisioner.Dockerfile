# workspace-sandbox-provisioner — the ONLY container that holds the Docker
# runtime socket for WORKSPACE_SANDBOX execution (WE-20261104).
#
# The daemon itself is a stdlib-only Go binary; the runtime image ships the
# Docker CLI so it can drive sibling containers over the mounted socket.
# Station never mounts the socket and never shares this image.

FROM golang:1.24 AS build
WORKDIR /src
# The provisioner and its internal package are stdlib-only; the station app
# module is sufficient (unused local replace targets are not compiled).
COPY apps/station/app/ ./
RUN CGO_ENABLED=0 GOFLAGS=-mod=mod \
    go build -trimpath -o /out/workspace-sandbox-provisionerd \
      ./cmd/workspace-sandbox-provisionerd

FROM docker:27-cli
# wget for the container healthcheck; ca-certificates for the docker daemon TLS.
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/workspace-sandbox-provisionerd \
     /usr/local/bin/workspace-sandbox-provisionerd
EXPOSE 8090
ENTRYPOINT ["workspace-sandbox-provisionerd"]
