// federation_health_handler.go — public readiness probe for the
// federation layer. Surface: GET /actor/federation/health
//
// Why public (no JWT)?
//   * Operators monitor it from outside this station's account system
//     (e.g. a Prometheus exporter, an external uptime check).
//   * The Desktop client hits it on its splash screen — before the
//     user has logged in — to decide whether to disable the "search
//     contacts" entry until the federation has joined.
//
// Wire format is content-negotiated through SuccessResponse: the
// Desktop client sends `Accept: application/protobuf` and gets a
// FederationHealthView wrapped in PeersResponse; curl / Prometheus
// hit the JSON branch by default. The endpoint always returns 200 —
// "not ready" is a body-level signal, never a transport error, so
// uptime scrapers do not alert on a station that is merely "still
// joining the federation".

package touch

import (
	"context"
	"time"

	"github.com/cloudwego/hertz/pkg/app"
	fednode "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	apipb "github.com/peers-labs/peers-touch/station/frame/touch/federation/api/pb"
)

// FederationHealth assembles a routing-readiness snapshot from the
// bootstrap-subserver-owned counters. Read-only and lock-free — every
// accessor (RoutingTable, Network, Connectedness) is itself
// goroutine-safe. The handler never queries libp2p directly; it goes
// through the federation package's RoutingHealth interface so a future
// swap to a different DHT implementation does not need to touch this
// file.
func FederationHealth(c context.Context, ctx *app.RequestContext) {
	snap := fednode.GetRoutingHealth()
	id := fednode.LocalIdentitySnapshot()

	view := &apipb.FederationHealthView{
		Ready:               snap.Ready,
		PeersInRoutingTable: int32(snap.PeersInRoutingTable),
		ConnectedPeers:      int32(snap.ConnectedPeers),
		SeedsConfigured:     int32(snap.SeedsConfigured),
		SeedsConnected:      int32(snap.SeedsConnected),
		MinDhtPeers:         int32(snap.MinDHTPeers),
		StationDomain:       id.StationDomain,
	}
	if id.StationPeerID != "" {
		view.StationPeerId = id.StationPeerID.String()
	}
	if !snap.BootStartedAt.IsZero() {
		view.BootStartedAt = snap.BootStartedAt.UTC().Format(time.RFC3339)
		view.UptimeSeconds = int64(time.Since(snap.BootStartedAt).Seconds())
	}
	SuccessResponse(c, ctx, "federation health", view)
}
