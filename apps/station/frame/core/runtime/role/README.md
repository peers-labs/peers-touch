# Runtime Role

This package is the single owner of Station process role selection.

- `PEERS_NODE_ROLE=station` enables Station application subservers, Touch
  routes, and the explicit Station plugin allowlist.
- `PEERS_NODE_ROLE=relay` disables Station business surfaces and enables only
  the Relay plugin.
- Missing or unknown roles fail startup.

Role is resolved once at the binary composition root and propagated through the
process context. Composition layers must consult this package instead of reading
the environment independently.
