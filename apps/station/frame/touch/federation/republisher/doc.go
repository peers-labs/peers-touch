// Package republisher keeps this station's locally-owned actor records
// alive in the federation DHT.
//
// libp2p kad-DHT records expire after a fixed TTL (24h by default).
// Without a re-publisher every station that restarts — or whose seed
// peers churn — eventually falls off the federation graph as its
// records age out, even though the actor rows in touch_actor remain
// authoritative. The republisher is the freshness-keeper that closes
// that loop:
//
//   * On Start, immediately republish every visible local actor so a
//     freshly-restarted station does not wait an hour for its records
//     to reappear in peer DHT replicas.
//   * Every Interval (default 12h, half the DHT TTL), repeat the same
//     scan so live records never approach expiration.
//
// Failure mode: any individual PublishVisibility error is logged and
// skipped — one bad row must not block the rest of the scan. The next
// tick retries automatically. The function intentionally does not
// race with concurrent SignUp / visibility-flip publishes; the
// underlying touch_actor.locator_seq increment is atomic, so seq
// always grows monotonically across all publishers.
package republisher
