# Core

## Layers
- First‑class (protocol/framework abstractions): `auth`, `server`, `option`, `config`, `plugin`, `peers`
- Facility layer (procedural/common components) under `facility/`:
  - `facility/session`: generic session abstractions and implementations (memory/disk; redis planned)
  - `facility/storage`: storage abstractions and local storage implementation, with cross‑platform app directory helpers
  - `facility/appdir`: cross‑platform application directory resolver that merges `paths.yml`, env and flags

Facility components depend only on core abstractions and the standard library; they never depend on business code (touch) or concrete protocols. Subservers and touch consume `facility/*` to reuse procedural capabilities and keep path conventions consistent.
Core libs for all projects. it is semantically irrelevant to the ActivityPub protocol, but provides common functionality for building the network, which like network, logger, discovery, etc.  

* [Peers](./peers): common entrance for core libs
  * [Config](./peers/config): configs for peers
