---
kind: pitfall
title: Dockerfile FROM with single-arch mirror breaks cross-arch builds
status: active
owns:
  - tooling/docker/station.Dockerfile
related:
  - docs/architecture/engineering/acceptance/execution-plans/20260824-native-desktop-runtime-cells.md
detected: 2026-09-02
---

# Dockerfile FROM with single-arch mirror breaks cross-arch builds

## Symptom

`docker compose up --build` on ARM64 host: `exec /bin/sh: exec format error`.

## Root cause

`FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/golang:1.24.6`
pulled an amd64-only mirror artifact. The defect was the unverified
single-architecture mirror, not qualification by itself.

Use official image names when the target Docker daemon has a reviewed
`registry-mirrors` configuration. A target without a daemon mirror may use an
explicit major-vendor image only after its manifest is verified to contain the
required architectures.

## Mitigation

### What was done in code

- `station.Dockerfile` uses Tencent Cloud's public multi-architecture Ubuntu
  22.04 image for both stages.
- The builder installs the pinned Go toolchain from the Alibaba Cloud mirror,
  so it does not depend on an unverified language-image mirror.

### What guards against regression

- Official names require a target-side reviewed registry mirror.
- Explicit registry names must be major-vendor sources and their manifest must
  include every claimed build architecture.
- Do not restore the single-architecture Huawei proxy or the unstable
  DaoCloud pass-through used by the regression.

## How to detect a recurrence

```bash
grep -E '^(FROM|ARG .+_IMAGE=|ARG GO_VERSION=)' tooling/docker/station.Dockerfile

docker manifest inspect ccr.ccs.tencentyun.com/library/ubuntu:22.04
# The manifest must contain both linux/amd64 and linux/arm64.

rg 'mirrors.aliyun.com/golang/go\\$\\{GO_VERSION\\}' tooling/docker/station.Dockerfile
# The pinned Go toolchain must come from the reviewed Alibaba Cloud mirror.
```
