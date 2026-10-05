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
bypasses `registry-mirrors` and pulls amd64-only from that registry. Use
official image names (`FROM golang:1.24.6`) so Docker resolves through
`registry-mirrors` and picks the correct arch.

## Mitigation

### What was done in code

- `station.Dockerfile` ARG defaults changed to `golang:1.24.6` and `ubuntu:22.04`.

### What guards against regression

- `station.Dockerfile` `FROM` / `ARG *_IMAGE` lines must never contain a
  fully-qualified non-Docker-Hub registry.

## How to detect a recurrence

```bash
grep -E '^(FROM|ARG .+_IMAGE=)' tooling/docker/station.Dockerfile | grep -v 'docker.io'
# Any match that contains a third-party registry hostname is a violation.
```
