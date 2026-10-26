# Schema

Shared link codec and standard QR presentation. Business owners supply typed
payloads; this package does not discover a Station, issue credentials or execute
scanned actions.

```tsx
import { Schema } from '@peers-touch/schema';

<Schema.QRCode
  content={{ kind: 'url', value: 'https://example.org/' }}
  title="Open the account page"
  errorLabel="The code does not fit in this space"
  constraints={{ size: 320, style: 'peers', pixelRatio: 2 }}
/>;
```

`Schema.encode` accepts a URL, registered navigation or generated `SchemaAction`.
`Schema.parse` returns `recognized`, `malformed` or `unsupported`. Device Link
actions use `peers-touch://device/link#`; ordinary typed actions use
`peers-touch://action/v1#`. Existing `pt://`, connection and OAuth routes retain
their own semantics. Callers dispatch only the recognized kind they own.

External safety-number and channel payloads use `external-protocol` with a
declared owner. Their UTF-8 bytes remain unchanged and are never executable link
actions. QR diagnostics include a digest, density and fallback reason; no payload.

Classic and Peers use pinned `qr-code-styling` 1.9.2. Peers decoration restores all
function regions from that encoder's actual matrix. Avatar input is a caller-owned
bitmap Blob, rasterized without metadata and checked for function-region overlap.
Unsafe avatar placement falls back without an avatar at ECC H.

The component measures its actual display width. It invalidates the old image on
resize instead of shrinking modules or clipping the quiet zone. `prepareQr`
returns an artifact with SVG/PNG export and explicit `dispose()`. PNG export,
avatar loading and cancellation are bounded; no shared payload cache exists.

Regenerate the canonical proto dependency closure with `pnpm --dir packages/schema
generate` or `model/build.sh`. Rust consumes the same contracts through
`packages/schema-core`; both codecs run `qa/link-vectors.json`.

Run `pnpm --dir packages/schema check` and `pnpm --dir packages/schema test`.
For browser verification, serve `packages/schema/qa` with Vite, then run
`qa/browser-check.py --url <local fixture> --output <external evidence directory>`.
It requires Python Playwright and Chromium. This fixture proves renderer behavior;
Android/iOS camera decoding and Device Link remain separate product evidence.
