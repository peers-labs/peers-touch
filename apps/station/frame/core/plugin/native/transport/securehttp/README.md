# Station Secure HTTP Stream

This package is the transport-owned adapter between one borrowed libp2p Host
and the existing Station Hertz listener.

It owns:

- `/peers-touch/station-http/1.0.0` stream negotiation;
- node-key-bound TLS 1.3 with `h2` ALPN and signed-route SPKI pinning;
- HTTP/2 connection limits and liveness;
- streaming loopback proxying into the existing Hertz router;
- direct and Circuit stream clients bound to one verified node route.

It does not own the Host lifecycle, route discovery, Session or business
authorization, Hertz route registration, domain retries, or a TCP listener.
Closing an ingress or client must not close its borrowed Host.
