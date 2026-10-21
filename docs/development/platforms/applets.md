# Official Applet Development

> **Status**: active
> **Scope**: `apps/applets/`, `packages/applet-*`

Official applets are first-party product units that use the same package,
Host, SDK, permission, service, and evidence contracts required of external
producers.

## Read First

1. [Official applets](../../../apps/applets/README.md)
2. [Applet runtime architecture](../../architecture/platform/applet-runtime/README.md)
3. [Official applet contract](../../architecture/platform/applet-runtime/official-applet-architecture-contract.md)
4. [Applet SDK guide](../../global/coding-guide/desktop/applet.md)

Use the nearest applet README for its business domain and service boundary.

## Create

```bash
pnpm applet:create-official \
  --id peers.example \
  --service example \
  --name Example
```

The scaffold creates the canonical product-unit shape. Do not manually invent
a second manifest, bridge, package, or service layout.

## Check

```bash
pnpm applet:validate <package-directory>
pnpm applet:official-contract-gate
pnpm --dir apps/applets/<id>/frontend run check
pnpm --dir apps/applets/<id>/frontend run build
```

Select additional Host or product-window Gates only for the behavior being
claimed. A generated fixture or browser Host does not prove a native packaged
product Journey.

## Boundaries

- Frontends use `@peers-touch/applet-sdk`, never raw Host or backend URLs.
- Services follow Station domain boundaries.
- Shared cross-process contracts remain proto-first.
- Hosts consume built applet artifacts; they do not import applet product
  source.
- Runtime evidence stays outside the source tree.
