// Package federation owns every piece of node-level libp2p policy that is
// shared across the dual-host architecture (the bootstrap subserver host
// and the transport host). Per-host concerns (identity key, listen-addrs,
// libp2p host options like enable-relay) stay in their respective plugin
// packages; per-node concerns live here.
//
// What lives here today:
//   - bootstrap-nodes   : the seed list every libp2p host (and every DHT in
//     the process) trusts as a federation entry point.
//   - public-addrs      : the multiaddrs this node announces to the world.
//   - direct-outbound   : ConnectionGater outbound rule. False ⇒ libp2p
//     dials are restricted to bootstrap-nodes.
//   - direct-inbound    : ConnectionGater inbound rule. False ⇒ libp2p
//     accepts are restricted to bootstrap-nodes.
//
// The package exposes two consumer-facing APIs:
//   - LibP2PHostOptions(): []libp2p.Option, splatted into every libp2p.New()
//     call in the process. Currently injects the AddrsFactory and the
//     ConnectionGater; future additions (pubsub options, transport filters,
//     etc.) compose here without changing call sites.
//   - BootstrapSeeds(): []peer.AddrInfo, consumed by every kad-DHT host
//     (bootstrap subserver's DHT, registry's DHT) for seed dialing.
package federation
