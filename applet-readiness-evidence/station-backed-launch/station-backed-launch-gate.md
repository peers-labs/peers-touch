# Station-backed Launch Gate

> Evidence class: CONTROLLED_LOCAL_UPSTREAM
> Third-party validation applet: `big-a`
> Internal validation applet: `peers.note`

## Checks

- third-party `big-a`: PASS
- third-party `big-a` version: `0.1.0`
- third-party `big-a` entry: `main.lynx.bundle`
- third-party `big-a` stored assets: 1
- third-party `big-a` install status: `1`
- internal `peers.note`: PASS
- internal `peers.note` version: `0.1.0`
- internal `peers.note` entry: `main.lynx.bundle`
- internal `peers.note` stored assets: 1
- internal `peers.note` install status: `1`

## Scope

- Publishes packages through Station Store typed publish.
- Installs packages through Station Store install state.
- Verifies every manifest integrity file is saved in Store bundle storage.
- Uses `big-a` for third-party validation and `peers.note` for internal validation.

## Not Covered

- This gate does not start the full Desktop product window.
- Gateway policy runtime enforcement and audit flush are separate gates.
- Evidence remains local controlled upstream, not a live authenticated Station deployment.
