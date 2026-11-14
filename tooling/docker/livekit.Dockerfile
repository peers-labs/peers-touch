# Existing LiveKit SFU, pinned upstream with a narrow admission extension.
# The patcher verifies the SHA256 of each modified upstream source file.
FROM golang:1.26-alpine AS builder
ARG TARGETARCH
RUN apk add --no-cache python3
WORKDIR /workspace
ADD https://codeload.github.com/livekit/livekit/tar.gz/b93c1e160770d93179dc5b1c9027567befec5e62 /tmp/livekit.tar.gz
RUN tar -xzf /tmp/livekit.tar.gz --strip-components=1 -C /workspace
COPY tooling/docker/patch-livekit.py /overlay/patch-livekit.py
COPY tooling/docker/livekit-admission.go /overlay/livekit-admission.go
COPY tooling/docker/livekit-admission_test.go /overlay/livekit-admission_test.go
RUN python3 /overlay/patch-livekit.py /workspace && \
    cp /overlay/livekit-admission.go pkg/service/peers_group_admission.go && \
    cp /overlay/livekit-admission_test.go pkg/service/peers_group_admission_test.go && \
    gofmt -w pkg/service/roommanager.go pkg/service/server.go pkg/service/peers_group_admission.go pkg/service/peers_group_admission_test.go
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go test $(go list -f '{{range .GoFiles}}{{$.Dir}}/{{.}} {{end}}' ./pkg/service) \
      /workspace/pkg/service/peers_group_admission_test.go -run '^TestPeers' && \
    CGO_ENABLED=0 GOOS=linux GOARCH=$TARGETARCH go build -trimpath -o /livekit-server ./cmd/server

FROM alpine:3.23
RUN apk add --no-cache ca-certificates
LABEL org.opencontainers.image.source="https://github.com/livekit/livekit" \
      org.opencontainers.image.revision="b93c1e160770d93179dc5b1c9027567befec5e62" \
      net.peers-touch.group-admission="sid-fence-replay-deny-v1"
COPY --from=builder /livekit-server /livekit-server
ENTRYPOINT ["/livekit-server"]
