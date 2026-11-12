# Workspace sandbox base image (WE-20261104).
#
# Industry-standard Ubuntu LTS base with the minimal tool set an agent uses
# for bounded read/build commands, running as a non-root user. The
# provisioner adds the real isolation at run time (read-only rootfs,
# no-new-privileges, drop ALL caps, isolated network, quotas); this image
# only provides unprivileged userspace tools.
#
# Build (mirror host used only at build time):
#   docker build \
#     --build-arg APT_MIRROR=mirrors.aliyun.com \
#     -t peers/workspace-sandbox-base:24.04-1 \
#     -f tooling/docker/sandbox/sandbox-base.Dockerfile tooling/docker/sandbox
#
# Pin at deployment time by digest (never run a mutable tag):
#   docker inspect -f '{{.Id}}' peers/workspace-sandbox-base:24.04-1
#   -> sha256:<content-id> for the provisioner SANDBOX_ALLOWED_IMAGE_IDS,
#      or <registry>/peers/workspace-sandbox-base@sha256:<digest> once pushed.
FROM ubuntu:24.04

ARG APT_MIRROR=mirrors.aliyun.com
ARG SANDBOX_UID=10001
ARG SANDBOX_GID=10001

ENV DEBIAN_FRONTEND=noninteractive

# Use an in-country apt mirror for reproducible builds in CN environments;
# the default mirrors.aliyun.com is the project's standard big-vendor mirror.
# Ubuntu 22.04 uses /etc/apt/sources.list; 24.04 uses the deb822 file
# /etc/apt/sources.list.d/ubuntu.sources — rewrite whichever exists.
RUN if [ -n "$APT_MIRROR" ] && [ "$APT_MIRROR" != "archive.ubuntu.com" ]; then \
      for f in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do \
        if [ -f "$f" ]; then \
          sed -i "s@http://archive.ubuntu.com@http://${APT_MIRROR}@g; s@http://security.ubuntu.com@http://${APT_MIRROR}@g" "$f"; \
        fi; \
      done; \
    fi \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates coreutils grep findutils util-linux \
      bash dash sed gawk tar gzip xz-utils curl \
      make git \
 && rm -rf /var/lib/apt/lists/*

# Unprivileged workload identity. Fixed uid/gid so bind-mounted workspace
# volumes can be chowned deterministically by the provisioner.
RUN groupadd --system --gid ${SANDBOX_GID} sandbox \
 && useradd --system --uid ${SANDBOX_UID} --gid ${SANDBOX_GID} \
      --home-dir /workspace --shell /bin/bash sandbox \
 && mkdir -p /workspace /tmp \
 && chown ${SANDBOX_UID}:${SANDBOX_GID} /workspace /tmp

USER ${SANDBOX_UID}:${SANDBOX_GID}
WORKDIR /workspace

# Kept alive by the provisioner (`sleep infinity`); one-shot work uses exec.
CMD ["sleep", "infinity"]
