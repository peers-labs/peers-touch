<div align="center">

# Peers-Touch

### A social network you actually own.

Your identity, relationships, conversations, and memories — running on infrastructure you control, connected to everyone else, with an AI that works for you.

[How it works](#what-were-building) · [See it in action](#see-it-in-action) · [Roadmap](#roadmap) · [GitHub](https://github.com/peers-labs/peers-touch)

</div>

---

## What we're building

We are building **a social network with no company at the center** — one where a person's social life is theirs, not a platform's.

Today, leaving a social network means leaving your identity, your friends, your posts, and your history behind. A company holds the keys, sets the rules, and decides what you see. Peers-Touch exists to change that:

- **You own your social world.** It runs in a place you control, not someone else's cloud. Your data isn't mined, sold, or held hostage.
- **You keep your identity.** Your identity is portable. Move it, run it yourself, and you are still you — with the same relationships and history.
- **You connect with everyone.** Independent servers interconnect the way email providers do. There is no central gatekeeper between you and anyone on any other server.
- **You define your personal Agent.** Choose its model, context, tools, and permissions; it joins the network as an identity you control.
- **You get real products, not a protocol hobby.** Fast, native desktop and mobile apps that work offline, stay in sync, and feel as polished as the best closed apps.

The goal is simple and ambitious: **the full social experience people love — messaging, group chat, a private feed, voice and video, and intelligent assistants — without giving up ownership.**

## What you can do

A single product across desktop and mobile:

- **Talk** — direct and group conversations, reactions, and rich messages, with end-to-end encryption where it matters.
- **Share** — a personal feed for the people in your life, not a public square run by an algorithm.
- **Call** — voice and video, peer-to-peer where possible.
- **Ask** — an Agent you configure, using the context and tools you choose.
- **Extend** — lightweight apps that add new capabilities to your social world.
- **Federate** — reach people on servers other than your own, with no central service in between.

## See it in action

Product screenshots for Desktop, Mobile, and cross-Station federation will be
published here as the corresponding release surfaces stabilize.

## Who it's for

- People who want a **daily-use social app** without surrendering their data.
- Self-hosters and small communities who want to **run their own social space**.
- Developers who want to **build on an open, owned social substrate** — including AI agents and apps.
- Anyone who believes their relationships and memories **shouldn't belong to a platform**.

---

<div align="center">

## For the technically curious

*Everything below is for builders. As a user, the product just works.*

</div>

## Project status

**Active development.** The foundation and social/messaging layers are runnable in development; AI agents and extensions are being built on top. Phases and dates will be tracked in the [Roadmap](#roadmap).

## Architecture

The product is three layers with clear responsibilities:

```text
┌──────────────────────────────────────────────┐
│ CLIENT   Desktop · Mobile                    │  experience, device
│                                              │  capabilities, AI /
│                                              │  extension runtimes
└───────────────────┬──────────────────────────┘
                    │ consumes generated contracts
┌───────────────────▼──────────────────────────┐
│ MODEL    model/domain/*.proto                │  protobuf contracts,
│                                              │  defined once
└───────────────────┬──────────────────────────┘
                    │ generated code + protocol contracts
┌───────────────────▼──────────────────────────┐
│ STATION  apps/station (frame + app)          │  storage, federation,
│                                              │  permissions, shared
│                                              │  business truth
└──────────────────────────────────────────────┘
```

- **Client** owns UI, interaction, device capabilities, and local orchestration — it is not the source of shared business truth.
- **Model** is the proto-first contract layer: shared structures are defined once and generated for every platform.
- **Station** owns shared business state, federation, persistence, and server-side policy.

Full picture: [docs/global/architecture.md](docs/global/architecture.md).

## Try it

Runtimes are started through the profile-driven scripts rather than launched by hand.

```bash
make station   # Build and run the Station (local / compose / remote profile)
make desktop   # Start the Desktop app (native Tauri)
make mobile    # Start the Mobile client (iOS simulator)
```

Prerequisites (pnpm 9, Go, Rust/Tauri, Docker) and profiles are covered in [docs/global/local-dev-environment.md](docs/global/local-dev-environment.md). Use `make profile <name>` to select a mode and `make config` to inspect it.

### Verification

| Platform | Command |
|----------|---------|
| Desktop | `cd apps/desktop && pnpm run check && pnpm run test && pnpm run build` |
| Station | `cd apps/station && go test ./...` |
| Mobile  | `pnpm mobile:check` |

## Roadmap

<!-- TODO: publish the phase plan and dates here; the product site carries the current working view. -->

The phase plan is being finalized. The working view — foundation, social & messaging, intelligence & extensions, and voice/video — is on the product site's Roadmap. Milestones and dates will be published here as they settle.

## Repository layout

```text
apps/
  station/        Go backend — frame (framework) + app (DDD subservers)
  desktop/        Tauri + React/TypeScript + Rust
  mobile/         Tauri v2 Mobile — web UI + Rust kernel + native plugins
  applets/        official extensions
  official-site/  product website (Astro, static, English/中文)
  oauth2-client/  OAuth login broker client
model/domain/     protobuf contract sources (single source of truth)
packages/         extension SDK/kernel, chat & secure-content cores, storage, UI, locales
docs/             architecture, platform, and specification documents
tooling/          scripts, Make modules, and canonical agent skills
```

## Documentation

Start at [docs/README.md](docs/README.md).

| What you need | Where to look |
|---------------|---------------|
| What & why | [docs/global/project-identity.md](docs/global/project-identity.md) |
| System architecture | [docs/global/architecture.md](docs/global/architecture.md) |
| Architecture catalog | [docs/architecture/README.md](docs/architecture/README.md) |
| Local environment | [docs/global/local-dev-environment.md](docs/global/local-dev-environment.md) |
| Development workflow | [docs/global/workflow.md](docs/global/workflow.md) |
| Contributing guide | [docs/global/contributing.md](docs/global/contributing.md) |

## Contributing

Peers-Touch supports human developers and AI agents working together.

- **Developers:** use a worktree, read the platform docs for the area you change, and follow the development workflow.
- **AI agents:** read [AGENTS.md](AGENTS.md) on startup, then the platform entry under `docs/.agent/`. Canonical skills live in `tooling/skills/`.

Before non-trivial work, publish intent with `make dev-start`; see the [contributing guide](docs/global/contributing.md) for details.

## Acknowledgements

Peers-Touch draws inspiration from open projects in decentralized social,
messaging, and federation, including the ecosystems around ActivityPub,
Hertz, libp2p, and the broader self-hosting community.
